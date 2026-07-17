'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { tokenBucketCalc, slidingWindowCalc } = require('../../src/utils/algorithms');

describe('tokenBucketCalc', () => {
  test('allows a request when the bucket is full', () => {
    const state = { tokens: 100, lastRefillMs: 0 };
    const res = tokenBucketCalc(state, {
      capacity: 100,
      refillRatePerSec: 10,
      cost: 30,
      nowMs: 0,
    });
    assert.equal(res.allowed, true);
    assert.equal(res.tokens, 70);
  });

  test('rejects a request that costs more than available tokens', () => {
    const state = { tokens: 5, lastRefillMs: 0 };
    const res = tokenBucketCalc(state, {
      capacity: 100,
      refillRatePerSec: 10,
      cost: 30,
      nowMs: 0, // no time elapsed -> no refill
    });
    assert.equal(res.allowed, false);
    assert.equal(res.tokens, 5);
  });

  test('refills proportionally to elapsed time', () => {
    const state = { tokens: 0, lastRefillMs: 0 };
    // 5 seconds elapsed at 10 tokens/sec => 50 tokens available
    const res = tokenBucketCalc(state, {
      capacity: 100,
      refillRatePerSec: 10,
      cost: 40,
      nowMs: 5000,
    });
    assert.equal(res.allowed, true);
    assert.equal(res.tokens, 10); // 50 refilled - 40 spent
  });

  test('never refills past capacity', () => {
    const state = { tokens: 90, lastRefillMs: 0 };
    // huge elapsed time would refill way past capacity without the cap
    const res = tokenBucketCalc(state, {
      capacity: 100,
      refillRatePerSec: 10,
      cost: 100,
      nowMs: 1_000_000,
    });
    assert.equal(res.allowed, true);
    assert.equal(res.tokens, 0); // capped at 100, then fully spent
  });

  test('a request costing more than capacity is always rejected', () => {
    const state = { tokens: 100, lastRefillMs: 0 };
    const res = tokenBucketCalc(state, {
      capacity: 100,
      refillRatePerSec: 10,
      cost: 150,
      nowMs: 0,
    });
    assert.equal(res.allowed, false);
    assert.equal(res.retryAfterMs, Infinity);
  });

  test('retryAfterMs reflects time needed to afford the request', () => {
    const state = { tokens: 0, lastRefillMs: 0 };
    // need 20 tokens, refilling at 10/sec => 2000ms
    const res = tokenBucketCalc(state, {
      capacity: 100,
      refillRatePerSec: 10,
      cost: 20,
      nowMs: 0,
    });
    assert.equal(res.allowed, false);
    assert.equal(res.retryAfterMs, 2000);
  });
});

describe('slidingWindowCalc', () => {
  const windowMs = 60_000; // 1 minute windows
  const limit = 100;

  test('allows requests under the limit within a single window', () => {
    const state = { currCount: 0, prevCount: 0, windowId: 0 };
    const res = slidingWindowCalc(state, { windowMs, limit, cost: 1, nowMs: 1000 });
    assert.equal(res.allowed, true);
    assert.equal(res.currCount, 1);
  });

  test('rejects once the estimated count exceeds the limit', () => {
    const state = { currCount: 100, prevCount: 0, windowId: 0 };
    const res = slidingWindowCalc(state, { windowMs, limit, cost: 1, nowMs: 1000 });
    assert.equal(res.allowed, false);
  });

  test('weights the previous window down as the current window progresses', () => {
    // Previous window was completely full (100 requests). We're 90% of the
    // way through the current window, so only ~10% of the previous window's
    // load should still count.
    const state = { currCount: 0, prevCount: 100, windowId: 1 };
    const nowMs = windowMs + Math.floor(windowMs * 0.9);
    const res = slidingWindowCalc(state, { windowMs, limit, cost: 1, nowMs });
    // estimated ~= 0 + 100 * 0.1 = 10, well under the limit of 100
    assert.equal(res.allowed, true);
  });

  test('rolls state forward by exactly one window (prev becomes curr)', () => {
    const state = { currCount: 42, prevCount: 7, windowId: 0 };
    const nowMs = windowMs + 500; // now in window 1
    const res = slidingWindowCalc(state, { windowMs, limit, cost: 1, nowMs });
    assert.equal(res.windowId, 1);
    assert.equal(res.prevCount, 42); // old curr becomes new prev
    assert.equal(res.currCount, 1); // fresh window, this request counted
  });

  test('resets prevCount to 0 after an idle gap of more than one window', () => {
    const state = { currCount: 42, prevCount: 7, windowId: 0 };
    const nowMs = windowMs * 5 + 500; // several windows later
    const res = slidingWindowCalc(state, { windowMs, limit, cost: 1, nowMs });
    assert.equal(res.windowId, 5);
    assert.equal(res.prevCount, 0);
  });

  test('remaining never goes negative', () => {
    const state = { currCount: 100, prevCount: 100, windowId: 0 };
    const res = slidingWindowCalc(state, { windowMs, limit, cost: 1, nowMs: 1000 });
    assert.ok(res.remaining >= 0);
  });
});
