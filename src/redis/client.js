'use strict';

const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');
const config = require('../config');

const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 2,
  lazyConnect: false,
});

redis.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[redis] connection error:', err.message);
});

// Register the Lua scripts as first-class commands on the client, e.g.
// redis.tokenBucket(1, key, capacity, refillRatePerSec, nowMs, cost)
// The leading numeric arg is the Redis convention for "number of KEYS".
redis.defineCommand('tokenBucket', {
  numberOfKeys: 1,
  lua: fs.readFileSync(path.join(__dirname, '..', 'limiters', 'tokenBucket.lua'), 'utf8'),
});

redis.defineCommand('slidingWindow', {
  numberOfKeys: 1,
  lua: fs.readFileSync(path.join(__dirname, '..', 'limiters', 'slidingWindow.lua'), 'utf8'),
});

module.exports = redis;
