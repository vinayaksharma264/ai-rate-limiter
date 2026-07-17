'use strict';

/**
 * Variable-cost limiter backed by the token-bucket Lua script. Use for
 * anything priced per-unit rather than per-request — the canonical case
 * here is LLM token usage.
 */
class TokenBucketLimiter {
  /**
   * @param {import('ioredis').Redis} redis - client with the `tokenBucket` command defined
   * @param {Object} opts
   * @param {number} opts.capacity - max tokens the bucket can hold
   * @param {number} opts.refillRatePerSec - tokens added per second
   * @param {string} [opts.keyPrefix]
   */
  constructor(redis, { capacity, refillRatePerSec, keyPrefix = 'ratelimit:tb' }) {
    this.redis = redis;
    this.capacity = capacity;
    this.refillRatePerSec = refillRatePerSec;
    this.keyPrefix = keyPrefix;
  }

  /**
   * @param {string} identifier - e.g. user id, API key, IP
   * @param {number} cost - tokens this request consumes
   * @returns {Promise<{allowed: boolean, remaining: number, retryAfterMs: number, limit: number}>}
   */
  async consume(identifier, cost = 1) {
    const key = `${this.keyPrefix}:${identifier}`;
    const now = Date.now();
    const [allowed, remaining, retryAfterMs] = await this.redis.tokenBucket(
      key,
      this.capacity,
      this.refillRatePerSec,
      now,
      cost
    );
    return {
      allowed: allowed === 1,
      remaining,
      retryAfterMs: retryAfterMs < 0 ? Infinity : retryAfterMs,
      limit: this.capacity,
    };
  }
}

module.exports = TokenBucketLimiter;
