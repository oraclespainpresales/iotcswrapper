'use strict';

// Module imports
var async = require('async')
  , dcl = require('./device-library.node')
  , Device = require('./device')
  , log = require('npmlog-ts')
  , util = require('util')
  , express = require('express')
  , WebSocketServer = require('ws').Server
  , http = require('http')
  , bodyParser = require('body-parser')
  , queue = require('block-queue')
  , _ = require('lodash')
  , isReachable = require('is-reachable')
  , fs = require('fs')
  , commandLineArgs = require('command-line-args')
  , getUsage = require('command-line-usage')
//  , syswidecas = require('syswide-cas')
;

//syswidecas.addCAs('/Users/ccasares/Desktop/iotserver');

// Misc BEGIN
const PROCESSNAME = "Anki Overdrive demo - IoTCS Wrapper";
const VERSION = "v1.1";
const AUTHOR  = "Carlos Casares <carlos.casares@oracle.com>";
const PROCESS = 'PROCESS';
const IOTCS   = 'IOTCS';
const REST    = "REST";
const QUEUE   = "QUEUE";
const DATA    = "DATA";
const ALERT   = "ALERT";
const ANKI    = "Anki Car";
log.timestamp = true;
var mainStatus = "STARTING";
// Misc END

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

// Initialize input arguments
const optionDefinitions = [
  { name: 'device', alias: 'd', type: String },
  { name: 'help', alias: 'h', type: Boolean },
  { name: 'verbose', alias: 'v', type: Boolean, defaultOption: false }
];

const sections = [
  {
    header: 'IoT Racing - IoTCS Wrapper',
    content: 'Wrapper to send racing events to IoTCS'
  },
  {
    header: 'Options',
    optionList: [
      {
        name: 'device',
        typeLabel: '[underline]{file}',
        alias: 'd',
        type: String,
        description: 'Device configuration file (.conf)'
      },
      {
        name: 'verbose',
        alias: 'v',
        description: 'Enable verbose logging.'
      },
      {
        name: 'help',
        alias: 'h',
        description: 'Print this usage guide.'
      }
    ]
  }
]
var options = undefined;

try {
  options = commandLineArgs(optionDefinitions);
} catch (e) {
  console.log(getUsage(sections));
  console.log(e.message);
  process.exit(-1);
}

if (options.help) {
  console.log(getUsage(sections));
  process.exit(0);
}

if (!options.device) {
  console.log(getUsage(sections));
  process.exit(-1);
}

if (!fs.existsSync(options.device)) {
  log.error("", "Device file %s does not exist or is not readable", options.device);
  process.exit(-1);
}

log.level = (options.verbose) ? 'verbose' : 'info';

// Initializing IoTCS variables BEGIN
dcl = dcl({debug: false});
var storePassword = 'Welcome1';
var urn = [
     'urn:oracle:iot:device:data:anki:car:lap'
   , 'urn:oracle:iot:device:data:anki:car:speed'
   , 'urn:oracle:iot:device:data:anki:car:transition'
];

var alerts = [
  { deviceUrn: 'urn:oracle:iot:device:data:anki:car:speed', alertUrn: 'urn:oracle:iot:device:event:anki:car:offtrack' }
];

var car = new Device(ANKI, log);

// Init Devices
const delays = [10, 30, 60];
const connectionTestRetries = delays.length + 1;
var iotcsServer = "";
const storeFile = options.device;
car.setStoreFile(storeFile, storePassword);
car.setUrn(urn);
var devices = [ car ];
// Initializing IoTCS variables END

// Initializing REST & WS variables BEGIN
const PORT = process.env.IOTPORT || 8888;
const wsURI = '/ws';
const restURI = '/iot';
const sendDataURI = '/send/data/:urn';
const sendAlertURI = '/send/alert/:urn';
const getStatusURI = '/status';

var app    = express()
  , router = express.Router()
  , server = http.createServer(app)
  , wss = new WebSocketServer({
    server: server,
    path: wsURI,
    verifyClient: function (info) {
      return true;
    }
  });
;
// Initializing REST & WS variables END

// Initializing QUEUE variables BEGIN
var q = undefined;
var queueConcurrency = 1;
// Initializing QUEUE variables END

// IoTCS helpers BEGIN
function getModel(device, urn, callback) {
  device.getDeviceModel(urn, function (response, error) {
    if (error) {
      callback(error);
    }
    callback(null, response);
  });
}
// IoTCS helpers END

// Main handlers registration - BEGIN
// Main error handler
process.on('uncaughtException', function (err) {
  console.log("Uncaught Exception: " + err);
  console.log("Uncaught Exception: " + err.stack);
});
process.on('SIGINT', function() {
  log.info(PROCESS, "Caught interrupt signal");
  log.info(PROCESS, "Exiting gracefully");
  process.removeAllListeners()
  if (typeof err != 'undefined')
    log.error(PROCESS, err)
  process.exit(2);
});
// Main handlers registration - END

// Main initialization code

// Before entering the main code, we will check internet connectivity
// We will read the truststore file which contains the target IoTCS server
async.waterfall([
    function(next) {
      log.info(PROCESS, "%s - %s", PROCESSNAME, VERSION);
      log.info(PROCESS, "Author - %s", AUTHOR);
      next(null);
    },
/**
    async.apply(fs.readFile, storeFile, "utf8"),
    function (contents, next) {
      iotcsServer = contents.split("\n")[2].split("//")[1];
      next(null);
    },
    function (next) {
      // Check internet connection
      async.retry({
        times: connectionTestRetries,
        interval: function(retryCount) {
          return delays[retryCount-2] * 1000;
        }
      }, function(cb, results) {
        log.info(PROCESS, "Trying to reach server " + iotcsServer);
        isReachable(iotcsServer, (err, reachable) => {
          cb((reachable ? null : "unreachable"), reachable);
        });
      }, function(err, result) {
        if (!result) {
          // Server not available. Abort whole process
          log.error(PROCESS, "Server not available after %d attempts. Aborting process!", connectionTestRetries);
          process.exit(2);
        }
        log.info(PROCESS, "Server %s seems up & running...", iotcsServer);
        next(null);
      });
    },
**/
    function(next) {
      // Sequentially, we initialize IoTCS and then the WS and REST servers
      async.series( {
        iot: function(callbackMainSeries) {
          log.info(IOTCS, "Initializing IoTCS devices");
          log.info(IOTCS, "Using IoTCS JavaScript Libraries v" + dcl.version);
          async.eachSeries( devices, function(d, callbackEachSeries) {
            mainStatus = "INITDEV";
            async.series( [
              function(callbackSeries) {
                // Initialize Device
                log.info(IOTCS, "Initializing IoT device '" + d.getName() + "'");
                d.setIotDcd(new dcl.device.DirectlyConnectedDevice(d.getIotStoreFile(), d.getIotStorePassword()));
                callbackSeries(null);
              },
              function(callbackSeries) {
                // Check if already activated. If not, activate it
                if (!d.getIotDcd().isActivated()) {
                  log.verbose(IOTCS, "Activating IoT device '" + d.getName() + "'");
                  d.getIotDcd().activate(d.getUrn(), function (device, error) {
                    if (error) {
                      mainStatus = "ERRORACT";
                      log.error(IOTCS, "Error in activating '" + d.getName() + "' device (" + d.getUrn() + "). Error: " + error.message);
                      callbackSeries(error);
                    }
                    d.setIotDcd(device);
                    if (!d.getIotDcd().isActivated()) {
                      mainStatus = "ERRORACT";
                      log.error(IOTCS, "Device '" + d.getName() + "' successfully activated, but not marked as Active (?). Aborting.");
                      callbackSeries("ERROR: Successfully activated but not marked as Active");
                    }
                    callbackSeries(null);
                  });
                } else {
                  log.verbose(IOTCS, "'" + d.getName() + "' device is already activated");
                  callbackSeries(null);
                }
              },
              function(callbackSeries) {
                // When here, the device should be activated. Get device models, one per URN registered
                mainStatus = "INITMOD";
                async.eachSeries(d.getUrn(), function(urn, callbackEachSeriesUrn) {
                  getModel(d.getIotDcd(), urn, (function (error, model) {
                    if (error !== null) {
                      mainStatus = "ERRMOD";
                      log.error(IOTCS, "Error in retrieving '" + urn + "' model. Error: " + error.message);
                      callbackEachSeriesUrn(error);
                    } else {
                      d.setIotVd(urn, model, d.getIotDcd().createVirtualDevice(d.getIotDcd().getEndpointId(), model));
                      log.verbose(IOTCS, "'" + urn + "' intialized successfully");
                    }
                    callbackEachSeriesUrn(null);
                  }).bind(this));
                }, function(err) {
                  if (err) {
                    callbackSeries(err);
                  } else {
                    callbackSeries(null, true);
                  }
                });
              }
            ], function(err, results) {
              callbackEachSeries(err);
            });
          }, function(err) {
            if (err) {
              callbackMainSeries(err);
            } else {
              mainStatus = "IOTDEVOK";
              log.info(IOTCS, "IoTCS device initialized successfully");
              callbackMainSeries(null, true);
            }
          });
        },
        websockets: function(callback) {
          // TODO
          callback(null)
        },
        queue: function(callback) {
          log.info(QUEUE, "Initializing QUEUE system");
          q = queue(queueConcurrency, (task, done) => {
            if ( task.type === DATA) {
              log.verbose(QUEUE, "Processing: %j", task);
              var vd = car.getIotVd(task.urn);
              if (vd) {
                log.verbose(QUEUE, "Sending data");
                vd.update(task.data);
              } else {
                log.error(QUEUE, "URN not registered: " + task.urn);
              }
            } else if ( task.type === ALERT) {
              var a = _.find(alerts, {alertUrn: task.urn});
              if (a) {
                var vd = car.getIotVd(a.deviceUrn);
                if (vd) {
                  var alert = vd.createAlert(task.urn);
                  Object.keys(task.data).forEach(function(key) {
                    alert.fields[key] = task.data[key];
                  });
                  log.verbose(QUEUE, "Sending alert");
                  alert.raise();
                  log.verbose(IOTCS, "%s alert raised with data %j", task.urn, task.data);
                } else {
                  log.error(QUEUE, "Device for alert '" + a.alertUrn + "' not registered: " + a.deviceUrn);
                }
              } else {
                log.error(QUEUE, "Alert URN not registered: " + task.urn);
              }
            } else {
              // should never happen
            }
            done(); // Let queue handle next task
          });
          log.info(QUEUE, "QUEUE system initialized successfully");
          callback(null)
        },
        rest: function(callback) {
          log.info(REST, "Initializing REST Server");
          app.use(bodyParser.urlencoded({ extended: true }));
          app.use(bodyParser.json());
          app.use(restURI, router);
          router.post(sendDataURI, function(req, res) {
            var urn = req.params.urn;
            var body = req.body;
            log.verbose(REST, "Send '" + DATA + "' method invoked for URN '" + urn + "' with data: %j", body);
            q.push({
              type: DATA,
              urn: urn,
              data: body
            });
            res.send({result:"Message queued for processing"});
          });
          router.post(sendAlertURI, function(req, res) {
            var urn = req.params.urn;
            var body = req.body;
            log.verbose(REST, "Send '" + ALERT + "' method invoked for URN '" + urn + "' with data: %j", body);
            q.push({
              type: ALERT,
              urn: urn,
              data: body
            });
            res.send({result:"Message queued for processing"});
          });
          router.get(getStatusURI, function(req, res) {
            res.send(mainStatus);
          });
          mainStatus = "ALLOK";
          server.listen(PORT, function() {
            log.info(REST, "REST Server initialized successfully");
            callback(null);
          });
        }
      }, function(err, results) {
        if (err) {
          log.error("Error during initialization: " + err);
        } else {
          _.each(router.stack, (r) => {
            // We take just the first element in router.stack.route.methods[] as we assume one HTTP VERB at most per URI
            log.info(PROCESS, "'" + _.keys(r.route.methods)[0].toUpperCase() + "' method available at http://localhost:" + PORT + restURI + r.route.path);
          });
          log.info(PROCESS, 'Initialization completed');
        }
      });
    }
], function(err, results) {
  log.error(PROCESS, err.message);
  process.exit(2);
});
