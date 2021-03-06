const axios = require('axios')
const fs = require('fs')
const logr = require('./src/logger')
const db_name = process.env.DB_NAME || 'avalon'
const db_url = process.env.DB_URL || 'mongodb://localhost:27017'
const MongoClient = require('mongodb').MongoClient

const backupUrlMain = process.env.BACKUP_URL || "https://dtube.club/backup/"
const backupUrlOrig = "http://backup.d.tube/"

var createNet = parseInt(process.env.CREATE_NET || 0)
var shouldGetGenesisBlocks = parseInt(process.env.GET_GENESIS_BLOCKS || 0)

var replayState = parseInt(process.env.REPLAY_STATE || 0)
var rebuildState = parseInt(process.env.REBUILD_STATE || 0)
var replayCheck = 0


if (rebuildState)
    replayState = 0

let config = {
    host: 'http://localhost',
    port: process.env.HTTP_PORT || '3001',
    homeDir: "/home/ec2-user/",
    testnetDir: "/home/ec2-user/avalon_testnet/tavalon/avalon_testnet/",
    mainnetDir: "/home/ec2-user/tavalon/avalon/",
    scriptPath: "./scripts/start_mainnet.sh",
    logPath: "/avalon/avalon.log",
    replayLogPath: "/avalon/avalon.log",
    backupUrl: backupUrlMain + "$(TZ=GMT date +\"%d%h%Y_%H\").tar.gz",
    blockBackupUrl: backupUrlMain + "blocks.zip",
    genesisSourceUrl: backupUrlMain + "genesis.zip",
    mongodbPath: "/data/db"
}

var curbHeight = 0
var prevbHeight = 0
var replayFromDatabaseCount = 0
var reRunCount = 0
// try restarting before replaying for non-zero same height
var tryRestartForSameHeight = 0
var restartThreshold = 3
var sameHeightCount = 0
// How many times same height before replaying from database
var sameHeightThreshold = 5
var replayCount = 0
// How many times replay from database before rebuilding state
var replayCountMax = 5


var mongo = {
    init: (cb) => {
        MongoClient.connect(db_url, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        }, function(err, client) {
            if (err) throw err
            this.db = client.db(db_name)
            logr.info('Connected to '+db_url+'/'+this.db.databaseName)
            cb()
        })
    },
    dropDatabase: (cb) => {
        db.dropDatabase(function() {
            logr.info("Dropped avalon mongo db.")
            cb()
        })
    }
}

function getCurTime() {
    var td = new Date()
    var d = String(td.getDate()).padStart(2, '0')
    var m = String(td.getMonth()).padStart(2, '0')

    var y = String(td.getFullYear())
    var h = String(td.getHours()).padStart(2, '0')
    var mn = String(td.getMinutes()).padStart(2, '0')
    var s = String(td.getSeconds()).padStart(2, '0')

    var dt = y + "/" + m + "/" + d + " " + h + ":" + mn + ":" + s
    logr.info("\n")
    logr.info("Current Time = ", dt)
    logr.info("--------------------------------------------------")
}

var exec = require('child_process').exec;

function runCmd(cmdStr) {
    exec(cmdStr,
        function (error, stdout, stderr) {
            if (error !== null) {
                logr.info('exec error: ' + error);
                logr.info('stdout: ' + stdout);
                logr.info('stderr: ' + stderr);
            }
        }
    );
}

function getUrl() {
    var url = config.host + ":" + config.port
    return url
}

// sleep time expects milliseconds
function sleep (time) {
   return new Promise((resolve) => setTimeout(resolve, time));
}

function replayFromSelfBackup() {
    backupUrl = config.mongodbPath + "/backup"
}

function getGenesisBlocks() {
            mongo.init(function() {
                logr.info("Genesis collection started.")
                logr.info("Dropping avalon mongo db (getting genesis blocks)")
                mongo.dropDatabase(function(){
                    const genesisFilePath = "/avalon/genesis/genesis.zip"
                        if (fs.existsSync(genesisFilePath)) {
                            logr.info("Genesis.zip already exists")
                            shouldGetGenesisBlocks =  0
                        } else {
                            logr.info("Getting genesis.zip")
                            shouldGetGenesisBlocks = 0
                            cmd = "cd /avalon"
                            cmd += " && "
                            cmd += " unset REBUILD_FINISHED"
                            cmd += " && "
                            cmd += "if [[ ! -d \"/avalon/genesis\" ]]; then `mkdir /avalon/genesis`; `cd /avalon/genesis`; `wget -q --show-progress --progress=bar:force " + config.genesisSourceUrl + " >> " + config.replayLogPath + " 2>&1" + "`; fi"
                            runCmd(cmd)
                        }
                })
            })
    logr.info("Getting genesis blocks")
}

function replayAndRebuildStateFromBlocks(cb) {
    cmd = "if [[ ! `ps aux | grep -v grep | grep -v defunct | grep mongod` ]]; then `mongod --dbpath " + config.mongodbPath + " > mongo.log 2>&1 &`; fi"
    runCmd(cmd)

    cmd = "pgrep \"src/main\" | xargs --no-run-if-empty kill  -9"
    runCmd(cmd)

    backupUrl = config.blockBackupUrl
    cmd = "cd /avalon"
    cmd += " && "
    cmd += " unset REBUILD_FINISHED"
    cmd += " && "
    cmd += "if [[ ! -d \"/avalon/genesis\" ]]; then `mkdir /avalon/genesis`; `cd /avalon/genesis`; `wget -q --show-progress --progress=bar:force " + config.genesisSourceUrl + " >> " + config.replayLogPath + " 2>&1" + "`; fi"
    cmd += " && "
    cmd += "if [[ ! -d \"/avalon/dump\" ]]; then `mkdir /avalon/dump`; else `rm -rf /avalon/dump/*`; fi"
    cmd += " && "
    cmd += "cd /avalon/dump"
    cmd += " && "
    cmd += " rm -rf *"
    cmd += " && "
    cmd += "wget -q --show-progress --progress=bar:force " + config.blockBackupUrl + " >> " + config.replayLogPath + " 2>&1"
    cmd += " && "
    cmd += "cd /avalon"
    cmd += " && "
    cmd += "REBUILD_STATE=1 " + config.scriptPath + " >> " + config.logPath + " 2>&1"

    logr.info("Rebuilding state from blocks commands = ", cmd)
    runCmd(cmd)
    cb()
}

function replayFromAvalonBackup(cb) {
    cmd = "if [[ ! `ps aux | grep -v grep | grep -v defunct | grep mongod` ]]; then `mongod --dbpath " + config.mongodbPath + " > mongo.log 2>&1 &`; fi"
    runCmd(cmd)

    cmd = "pgrep \"src/main\" | xargs --no-run-if-empty kill  -9"
    runCmd(cmd)

    var backupUrl = config.backupUrl
    cmd = "cd /avalon"
    cmd += " && "
    cmd += "if [[ ! -d \"/avalon/dump\" ]]; then `mkdir /avalon/dump`; else `rm -rf /avalon/dump/*`; fi"
    cmd += " && "
    cmd += "cd /avalon/dump"
    cmd += " && "
    downloadCmd = "wget -q --show-progress --progress=bar:force " + backupUrl + " >> " + config.replayLogPath + " 2>&1"
    cmd += "if [[ ! -f $(TZ=GMT date +'%d%h%Y_%H').tar.gz ]]; then `" + downloadCmd + "`; fi" +  " && " + "tar xfvz ./*" + " >> " +  config.replayLogPath
    cmd += " && "
    cmd += "if [[ ! `ps aux | grep -v grep | grep -v defunct | grep mongorestore` ]]; then `mongorestore -d " + db_name + " ./ >> " + config.replayLogPath + " 2>&1`; fi"
    cmd += " && "
    cmd += "cd /avalon"
    cmd += " && "
    cmd += "if [[ ! `ps aux | grep -v grep | grep -v defunct | grep src/main` ]]; then `" + config.scriptPath + " >> " + config.logPath + " 2>1&" + "`; fi"

    logr.info("Replay from database snapshot commands = ", cmd)
    runCmd(cmd)
    cb()
}

function checkHeightAndRun() {
    var url = getUrl()
    axios.get(url + '/count').then((bHeight) => {
        curbHeight = bHeight.data.count

        getCurTime()

        logr.info('Previous block height = ', prevbHeight)
        logr.info('Current block height  = ', curbHeight)

        if(createNet) {
            if (prevbHeight == curbHeight) {
                var mineStartCmd = "curl http://localhost:3001/mineBlock"
                runCmd(mineStartCmd)
            }
        } else if (shouldGetGenesisBlocks) {

        } else if (prevbHeight == curbHeight) {
            //runCmd(runAvalonScriptCmd)
            if (replayState) {
                logr.info("Replaying from database")
            } else if (rebuildState) {
                logr.info("Rebuilding state from blocks")
                    mongo.init(function() {
                        logr.info("Dropping avalon mongo db (replayState from database snapshot)")
                        mongo.dropDatabase(function(){
                            replayAndRebuildStateFromBlocks(function() {
                                rebuildState = 0
                            })
                        })
                    })
            } else {
                sameHeightCount++
                if (replayCount == replayCountMax) {
                    logr.info('Replay count max reached. Rebuilding block state.')
                    /*
                    mongo.init(function() {
                        logr.info("Dropping avalon mongo db (replayState from database snapshot)")
                        mongo.dropDatabase(function(){
                        })
                    })
                    */

                } else if (sameHeightCount == sameHeightThreshold && replayState == 0) {
                    sameHeightCount = 0
                    logr.info('Same block height threshold reached. Replaying from database.')
                    if (curbHeight == 0 || tryRestartForSameHeight == restartThreshold) {
                        tryRestartForSameHeight = 0
                        mongo.init(function() {
                            logr.info("Dropping avalon mongo db (replayState from database snapshot)")
                            mongo.dropDatabase(function(){
                                replayState = 1
                                replayFromAvalonBackup(function(replayCount, replayState) {
                                    replayCount++
                                    replayState = 0
                                })
                            })
                        })
                    } else {
                        // kill main and restart
                        cmd = "pgrep \"src/main\" | xargs --no-run-if-empty kill  -9"
                        runCmd(cmd)

                        logr.info("Restarting avalon with new net")
                        runAvalonScriptCmd = config.scriptPath + " >> " + config.logPath + " 2>&1"
                        runCmd(runAvalonScriptCmd)
                        tryRestartForSameHeight++
                    }
                }
            }
        } else {
            // reset all variables
            sameHeightCount = 0
            replayCount = 0
            replayState = 0
            rebuildState = 0
            replayCheck = 0
        }
        prevbHeight = curbHeight

        setTimeout(() => checkHeightAndRun(), 5000)

    }).catch(() => {
        if(createNet) {
            mongo.init(function() {
                logr.info("Creating net")
                logr.info("Dropping avalon mongo db (creating new net)")
                mongo.dropDatabase(function(){
                    logr.info("Removing genesis.zip")
                    var removeGenesisCmd = "if [[ -d \"/avalon/genesis/genesis.zip\" ]]; then rm -rf /avalon/genesis; fi"
                    runCmd(removeGenesisCmd)

                    logr.info("Restarting avalon with new net")
                    runAvalonScriptCmd = config.scriptPath + " >> " + config.logPath + " 2>&1"
                    runCmd(runAvalonScriptCmd)
                });
            })
        } else if (shouldGetGenesisBlocks) {
            getGenesisBlocks()
        }
        else {
            if (replayState == 1) {
                logr.info("Replaying from database.. 2nd case")
                replayCheck++
                if (replayCheck == 5000) {
                    checkRestartCmd = ""
                    restartMongoDB = "if [[ ! `ps aux | grep -v grep | grep -v defunct | grep 'mongod --dbpath'` ]]; then `mongod --dbpath " + config.mongodbPath + " > mongo.log 2>&1 &`; fi && sleep 10"
                    restartAvalon = "if [[ ! `ps aux | grep -v grep | grep -v defunct | grep src/main` ]]; then `" + config.scriptPath + " >> " + config.logPath + " 2>1&" + "`; fi"

                    checkRestartCmd =  restartMongoDB + " && "
                    checkRestartCmd += "mongo --quiet " + db_name + " --eval \"db.blocks.count()\" > tmp.out 2>&1 && a=$(cat tmp.out) && sleep 5 &&  mongo --quiet " + db_name + " --eval \"db.blocks.count()\" > tmp2.out 2>&1 && b=$(cat tmp2.out) && sleep 15 && if [ $a == $b ] ; then " + restartAvalon + "; fi"
                    logr.info("Check restart command = " + checkRestartCmd)
                    runCmd(checkRestartCmd)
                    replayState = 0
                }
            } else if(rebuildState == 1) {
                logr.info("Rebuilding from blocks")
                replayAndRebuildStateFromBlocks(function() {
                })
                rebuildState = 0
            } else {
                logr.info("Replay/Rebuild didn't start yet or finished.")
            }
        }

        if (replayState == 0) {
            checkRestartCmd = ""
            restartMongoDB = "if [[ ! `ps aux | grep -v grep | grep -v defunct | grep 'mongod --dbpath'` ]]; then `mongod --dbpath " + config.mongodbPath + " > mongo.log 2>&1 &`; fi && sleep 10"
            restartAvalon = "if [[ ! `ps aux | grep -v grep | grep -v defunct | grep src/main` ]]; then `" + config.scriptPath + " >> " + config.logPath + " 2>1&" + "`; fi"

            checkRestartCmd =  restartMongoDB + " && "
            // increasing max sort byte
            checkRestartCmd += " mongo --quiet " + db_name + " --eval \"db.adminCommand({setParameter: 1, internalQueryExecMaxBlockingSortBytes: 935544320})\" && mongo --quiet " + db_name + " --eval \"db.blocks.count()\" > tmp.out 2>&1 && a=$(cat tmp.out) && sleep 5 &&  mongo --quiet " + db_name + " --eval \"db.blocks.count()\" > tmp2.out 2>&1 && b=$(cat tmp2.out) && sleep 15 && if [ $a == $b ] ; then " + restartAvalon + "; fi"
            logr.info("Check restart command = " + checkRestartCmd)
            runCmd(checkRestartCmd)
        }

        sleep(7000).then(() =>
            checkHeightAndRun()
        )
    })
}

// running first time
restartMongoDB = "if [[ ! `ps aux | grep -v grep | grep -v defunct | grep 'mongod --dbpath'` ]]; then `mongod --dbpath " + config.mongodbPath + " &`; sleep 5; fi"
runCmd(restartMongoDB)

restartAvalon = "if [[ ! `ps aux | grep -v grep | grep -v defunct | grep src/main` ]]; then `echo \" Restarting avalon\" >> " + config.logPath + " `; `" + config.scriptPath + " >> " + config.logPath + " 2>1&" + "`; fi"
runCmd(restartAvalon)

checkHeightAndRun()
