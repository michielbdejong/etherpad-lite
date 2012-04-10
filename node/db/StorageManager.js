/**
 * Initializes and caches remote storages with bearerToken verification.
 */

/*
 * 2012 Max 'Azul' Wiehle for the unhosted project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


var ERR = require("async-stacktrace");
var url = require("url");
var remote = require("./RemoteStorage");
var settings = require("../utils/Settings");
var redis = require("redis");
var client;

// cache all remote connections we have
var storages = {
  get: function (name) { return this[':'+name]; },
  set: function (name, value) { this[':'+name] = value; },
  remove: function (name) { delete this[':'+name]; }
};

//injecting redisClient so we can replace it for testing
exports.init = function(_client, _remote) 
{
  client = _client || redis.createClient(settings.redis.port, settings.redis.host);
  client.auth(settings.redis.pwd);
  if(_remote) remote = _remote;
}

function redisClient()
{
  if (!client) exports.init();
  return client;
}

exports.get = function(name, callback)
{
  var storage = storages.get(name);
  // not in cache
  if(storage != null)
  {
    callback(null, storage);
    return;
  }
  refresh(name, function(err, status){
    if(ERR(err, callback)) return;
    callback(null, storages.get(name));
  });
}

exports.set = function(name, storageInfo, bearerToken, callback)
{
  var storageAddress = storageInfo.template.replace('{category}','documents');
  // don't use the proxy for couchDB as we don't need cors
  if (storageInfo.ownPadBackDoor) storageAddress = storageInfo.ownPadBackDoor;

  var params = {
    storageAddress: storageAddress,
    bearerToken: bearerToken,
    storageApi: storageInfo.api
  };

  var remote_name=unhyphenify(name);
  initAndCache(name, params, function(err, state){
    var record = {
      storageInfo: storageInfo,
      bearerToken: bearerToken
    }
    if(!err) redisClient().set(remote_name, JSON.stringify(record));
    callback(err, state);
  });
}

exports.authenticate = function(name, token, callback)
{
  remote.validate(storages.get(name), token, function(err, _storage) {
    if(!err && storage) storages.set(name, _storage);
    callback(!err && storage);
  });
}

function paramsFromRecord(record) {
  return {
    storageAddress: record.ownPadBackDoor || record.storageInfo.template.replace('{category}','documents'),
    bearerToken: record.bearerToken,
    storageApi: record.storageInfo.api
  }
}

function refresh(name, callback)
{
  var remote_name=unhyphenify(name);
  console.log("loading "+remote_name+" from db");
  redisClient().get(remote_name, function(err, record)
  {
    if(ERR(err, callback)) {console.warn(err+':'+record); return;}
    record = JSON.parse(record);
    var params = paramsFromRecord(record);
    initAndCache(name, params, callback);
  });
}

function initAndCache(name, params, callback){
  remote.init(params, function(err, _storage) {
    if(err){
      _storage.storageStatus = 'invalid';
      callback(err, _storage);
      return;
    }
    storages.set(name, _storage);
    callback(null, {storageStatus: 'ready'});
  });
}

//TODO: we might need a lib for this kind of stuff somewhere
function unhyphenify(string) {
  if(string.indexOf('@') != -1) return string;
  var replacements = {dash: '-', dot: '.', at: '@'};
  parts=string.split('-');
  for(var i=1; i<parts.length; i+=2) {
    parts[i]=replacements[parts[i]];
  }
  return parts.join('');
}

