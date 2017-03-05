var method = Device.prototype;

var _ = require('lodash');

var util = require=('util');

function Device(name, log) {
  this._log = log;
  // Initialize device (sub)structures
  this._device = {};
  this._device.iotcs = {};
  this._device.name = name;
  this._device.virtualdevices = [];
}

method.setStoreFile = function(storeFile, passphrase) {
  this._device.iotcs.storeFile = storeFile;
  this._device.iotcs.storePassword = passphrase;
}

method.setUrn = function(urn) {
  this._device.iotcs.urn = urn;
}

method.setIotDcd = function(dcd) {
  this._device.iotcs.dcd = dcd;
}

method.setIotModel = function(model) {
  this._device.iotcs.model = model;
}

method.setIotVd = function(urn, model, vd) {
  this._device.virtualdevices.push({ urn: urn, model: model, device: vd });
  vd.onError = function (tupple) {
  	var errorMessage = tupple.errorResponse.toString();
  	//handle error message
//    this._log.error('IOTCS', "Error sending messages: " + errorMessage);
//    this._log.verbose('IOTCS', "Pending messages: " + JSON.stringify(tupple));
    console.log("Error sending messages: " + errorMessage);
    console.log("Pending messages: ");
    console.log(util.inspect(tupple, true, null));
//    console.log('[IOTCS] ' + "Error sending messages: " + errorMessage);
  	//based on the error message, handle update of attributes or resent of the alerts
  	setTimeout(function () {
  		Object.keys(tupple.attributes).forEach(function (key) {
  			//handle resend of alerts
  			if (tupple.attributes[key].type === "ALERT") {
  				tupple.attributes[key].raise();
  			}
  			//handle resend of custom data messages
  			else if (tupple.attributes[key].type === "DATA") {
  				tupple.attributes[key].submit();
  			}
  			//handle resend of attribute messages
  			else {
  				vd[key].value = tupple.tryValues[key];
  			}
  		})
  	},  5*1000);
  }
}

method.toString = function() {
  return JSON.stringify(this._device);
}
// Getters
method.getName = function() {
    return this._device.name;
};

method.getIotStoreFile = function() {
  return this._device.iotcs.storeFile;
}

method.getIotStorePassword = function() {
  return this._device.iotcs.storePassword;
}

method.getUrn = function() {
  return this._device.iotcs.urn;
}

method.getIotDcd = function() {
  return this._device.iotcs.dcd;
}

method.getIotVd = function(urn) {
  var vd = _.find(this._device.virtualdevices, { urn: urn });
  if (vd) return vd.device; else return undefined;
}

module.exports = Device;
