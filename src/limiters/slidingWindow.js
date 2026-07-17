'use strict';

/**
 * Fixed-cost (usually 1-per-request) limiter backed by the sliding-window
 * Lua script. Use for standard "N requests per M seconds" API limiting.
 */
class SlidingWindowLimiter {
  /**
   * @param {import('ioredis').Redis} redis - client with the `slidingWindow` command defined
   * @param {Object} opts
   * @param {number} opts.windowMs - window size in ms
   * @param {number} opts.limit - max requests allowed per window
   * @param {string} [opts.keyPrefix]
   */
  constructor(redis, { windowMs, limit, keyPrefix = 'ratelimit:sw' }) {
    this.redis = redis;
    this.windowMs = windowMs;
    this.limit = limit;
    this.keyPrefix = keyPrefix;
  }

  /**
   * @param {string} identifier - e.g. user id, API key, IP
   * @param {number} [cost] - weight of this request, default 1
   * @returns {Promise<{allowed: boolean, remaining: number, resetMs: number, limit: number}>}
   */
  async consume(identifier, cost = 1) {
    const key = `${this.keyPrefix}:${identifier}`;
    const now = Date.now();
    const [allowed, remaining, resetMs] = await this.redis.slidingWindow(
      key,
      this.windowMs,
      this.limit,
      now,
      cost
    );
    return {
      allowed: allowed === 1,
      remaining,
      resetMs,
      limit: this.limit,
    };
  }
}

module.exports = SlidingWindowLimiter;
