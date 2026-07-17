'use strict';

const express = require('express');
const rateLimit = require('../middleware/rateLimit');
const SlidingWindowLimiter = require('../limiters/slidingWindow');
const redis = require('../redis/client');
const config = require('../config');

const router = express.Router();

const generalLimiter = new SlidingWindowLimiter(redis, {
  windowMs: config.general.windowMs,
  limit: config.general.limit,
});

// Identify clients by IP for this demo. Swap for req.user.id / API key in
// a real deployment behind auth.
const keyGenerator = (req) => req.ip;

router.get(
  '/ping',
  rateLimit({ limiter: generalLimiter, keyGenerator }),
  (req, res) => {
    res.json({ ok: true, message: 'pong' });
  }
);

module.exports = router;
