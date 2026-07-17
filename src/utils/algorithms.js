'use strict';

/**
 * Pure calculation functions for the two rate-limiting algorithms.
 *
 * These have NO Redis or I/O in them on purpose: they take a "state" object
 * in, and return a decision + the next state, so they can be unit tested
 * with zero infrastructure. The Lua scripts in src/limiters/*.lua implement
 * the exact same math atomically inside Redis for production use — think of
 * these functions as the executable spec for those scripts.
 */

/**
 * Token bucket: a bucket holds up to `capacity` tokens and refills at
 * `refillRatePerSec` tokens/sec. A request of `cost` tokens is allowed only
 * if the bucket currently holds at least `cost` tokens, in which case they
 * are deducted. This naturally supports variable-cost requests, which is
 * why it's used for the AI/token mode (cost = estimated/actual LLM tokens)
 * instead of a flat "1 request = 1 unit" scheme.
 *
 * @param {Object} state - current bucket state
 * @param {number} state.tokens - tokens currently in the bucket
 * @param {number} state.lastRefillMs - epoch ms of the last refill
 * @param {Object} params
 * @param {number} params.capacity - max tokens the bucket can hold
 * @param {number} params.refillRatePerSec - tokens added per second
 * @param {number} params.cost - tokens this request costs
 * @param {number} params.nowMs - current epoch ms
 * @returns {{allowed: boolean, tokens: number, lastRefillMs: number, retryAfterMs: number}}
 */
function tokenBucketCalc(state, params) {
  const { capacity, refillRatePerSec, cost, nowMs } = params;

  if (cost > capacity) {
    // A request more expensive than the entire bucket can never succeed.
    return { allowed: false, tokens: state.tokens, lastRefillMs: state.lastRefillMs, retryAfterMs: Infinity };
  }

  const elapsedSec = Math.max(0, nowMs - state.lastRefillMs) / 1000;
  const refilled = Math.min(capacity, state.tokens + elapsedSec * refillRatePerSec);

  if (refilled >= cost) {
    return {
      allowed: true,
      tokens: refilled - cost,
      lastRefillMs: nowMs,
      retryAfterMs: 0,
    };
  }

  const deficit = cost - refilled;
  const retryAfterMs = Math.ceil((deficit / refillRatePerSec) * 1000);
  return {
    allowed: false,
    tokens: refilled,
    lastRefillMs: nowMs,
    retryAfterMs,
  };
}

/**
 * Sliding window counter (the algorithm popularized by Cloudflare's rate
 * limiting write-up): approximates a true sliding window using two fixed
 * windows. It's far cheaper to store than a sliding log (one counter per
 * window instead of one entry per request) while avoiding the burst-at-
 * the-boundary problem of a naive fixed window.
 *
 * estimatedCount = currentWindowCount + previousWindowCount * overlapWeight
 * where overlapWeight is how much of the previous window still "counts"
 * toward the current sliding view.
 *
 * @param {Object} state
 * @param {number} state.currCount - requests counted in the current fixed window
 * @param {number} state.prevCount - requests counted in the previous fixed window
 * @param {number} state.windowId - id (index) of the window `currCount` belongs to
 * @param {Object} params
 * @param {number} params.windowMs - fixed window size in ms
 * @param {number} params.limit - max requests allowed per sliding window
 * @param {number} params.cost - weight of this request (usually 1)
 * @param {number} params.nowMs - current epoch ms
 * @returns {{allowed: boolean, currCount: number, prevCount: number, windowId: number, remaining: number, resetMs: number}}
 */
function slidingWindowCalc(state, params) {
  const { windowMs, limit, cost, nowMs } = params;

  const windowId = Math.floor(nowMs / windowMs);
  const elapsedInCurrent = nowMs % windowMs;
  const overlapWeight = (windowMs - elapsedInCurrent) / windowMs;

  // If the window has rolled over (possibly by more than one window, if
  // there's been a long idle gap), shift state forward accordingly.
  let { currCount, prevCount, windowId: stateWindowId } = state;
  if (windowId !== stateWindowId) {
    if (windowId === stateWindowId + 1) {
      prevCount = currCount;
    } else {
      prevCount = 0;
    }
    currCount = 0;
  }

  const estimated = currCount + prevCount * overlapWeight;
  const resetMs = windowMs - elapsedInCurrent;

  if (estimated + cost <= limit) {
    return {
      allowed: true,
      currCount: currCount + cost,
      prevCount,
      windowId,
      remaining: Math.max(0, Math.floor(limit - (estimated + cost))),
      resetMs,
    };
  }

  return {
    allowed: false,
    currCount,
    prevCount,
    windowId,
    remaining: Math.max(0, Math.floor(limit - estimated)),
    resetMs,
  };
}

module.exports = { tokenBucketCalc, slidingWindowCalc };
