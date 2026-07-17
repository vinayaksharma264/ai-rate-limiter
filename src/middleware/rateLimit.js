'use strict';

/**
 * Wraps a limiter (TokenBucketLimiter or SlidingWindowLimiter — anything
 * with an async `.consume(identifier, cost) -> { allowed, remaining, ... }`
 * method) as Express middleware.
 *
 * @param {Object} opts
 * @param {{consume: Function}} opts.limiter
 * @param {(req: import('express').Request) => string} opts.keyGenerator - derives the client identifier
 * @param {(req: import('express').Request) => number} [opts.costFn] - derives the cost of this request, default 1
 */
function rateLimit({ limiter, keyGenerator, costFn = () => 1 }) {
  return async function rateLimitMiddleware(req, res, next) {
    const identifier = keyGenerator(req);
    const cost = costFn(req);

    let result;
    try {
      result = await limiter.consume(identifier, cost);
    } catch (err) {
      // Fail open: if Redis is down, don't take the whole API down with it.
      // Log loudly so this is visible in ops, but let the request through.
      // eslint-disable-next-line no-console
      console.error('[rateLimit] limiter error, failing open:', err.message);
      return next();
    }

    res.set('X-RateLimit-Limit', String(result.limit));
    res.set('X-RateLimit-Remaining', String(result.remaining));

    if (!result.allowed) {
      const retryAfterSec = Math.ceil(
        (result.retryAfterMs ?? result.resetMs ?? 1000) / 1000
      );
      res.set('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        error: 'rate_limit_exceeded',
        message: 'Too many requests. Please retry later.',
        retryAfterSeconds: retryAfterSec,
      });
    }

    return next();
  };
}

module.exports = rateLimit;
