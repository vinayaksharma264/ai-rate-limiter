'use strict';

/**
 * These tests hit a REAL Redis instance (they exercise the actual Lua
 * scripts, not the pure JS functions) — run `docker compose up -d` first,
 * or point REDIS_URL at any Redis you have. Run with:
 *
 *   npm run test:integration
 *
 * They're kept out of `npm test` on purpose so the fast unit suite never
 * needs infrastructure.
 */

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Redis = require('ioredis');
const fs = require('fs');
const path = require('path');

const TokenBucketLimiter = require('../../src/limiters/tokenBucket');
const SlidingWindowLimiter = require('../../src/limiters/slidingWindow');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

redis.defineCommand('tokenBucket', {
  numberOfKeys: 1,
  lua: fs.readFileSync(path.join(__dirname, '../../src/limiters/tokenBucket.lua'), 'utf8'),
});
redis.defineCommand('slidingWindow', {
  numberOfKeys: 1,
  lua: fs.readFileSync(path.join(__dirname, '../../src/limiters/slidingWindow.lua'), 'utf8'),
});

describe('TokenBucketLimiter (integration)', () => {
  const limiter = new TokenBucketLimiter(redis, { capacity: 100, refillRatePerSec: 1, keyPrefix: 'test:tb' });

  beforeEach(async () => {
    await redis.del('test:tb:client-a');
  });

  test('consumes tokens across repeated calls', async () => {
    const r1 = await limiter.consume('client-a', 40);
    assert.equal(r1.allowed, true);
    assert.equal(r1.remaining, 60);

    const r2 = await limiter.consume('client-a', 40);
    assert.equal(r2.allowed, true);
    assert.equal(r2.remaining, 20);

    const r3 = await limiter.consume('client-a', 40);
    assert.equal(r3.allowed, false);
  });
});

describe('SlidingWindowLimiter (integration)', () => {
  const limiter = new SlidingWindowLimiter(redis, { windowMs: 1000, limit: 5, keyPrefix: 'test:sw' });

  beforeEach(async () => {
    await redis.del('test:sw:client-b');
  });

  test('allows up to the limit then rejects', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await limiter.consume('client-b');
      assert.equal(r.allowed, true, `request ${i} should be allowed`);
    }
    const r6 = await limiter.consume('client-b');
    assert.equal(r6.allowed, false);
  });
});

after(async () => {
  await redis.quit();
});
