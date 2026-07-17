'use strict';

require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // General (sliding window) limiter defaults — fixed cost of 1 per request.
  general: {
    windowMs: parseInt(process.env.GENERAL_WINDOW_MS || '60000', 10), // 1 minute
    limit: parseInt(process.env.GENERAL_LIMIT || '100', 10), // 100 req/min
  },

  // AI (token bucket) limiter defaults — variable cost per request based on
  // estimated/actual LLM token usage.
  ai: {
    capacity: parseInt(process.env.AI_TOKEN_CAPACITY || '10000', 10), // burst budget
    refillRatePerSec: parseInt(process.env.AI_TOKEN_REFILL_PER_SEC || '200', 10), // ~ sustained TPM/300
  },
};
