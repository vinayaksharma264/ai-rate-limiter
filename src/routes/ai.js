'use strict';

const express = require('express');
const rateLimit = require('../middleware/rateLimit');
const TokenBucketLimiter = require('../limiters/tokenBucket');
const redis = require('../redis/client');
const config = require('../config');
const { estimateTokens } = require('../utils/estimateTokens');

const router = express.Router();

router.use(express.json());

const aiLimiter = new TokenBucketLimiter(redis, {
  capacity: config.ai.capacity,
  refillRatePerSec: config.ai.refillRatePerSec,
});

const keyGenerator = (req) => req.ip;

// Cost = estimated tokens in prompt + a fixed allowance reserved for the
// completion. In a real integration you would look at the actual
// `usage.total_tokens` the LLM API returns and reconcile the bucket
// afterward (see the comment at the bottom of the handler below).
const costFn = (req) => {
  const prompt = req.body?.prompt || '';
  const promptTokens = estimateTokens(prompt);
  const completionAllowance = 256;
  return promptTokens + completionAllowance;
};

router.post(
  '/chat',
  rateLimit({ limiter: aiLimiter, keyGenerator, costFn }),
  (req, res) => {
    const prompt = req.body?.prompt || '';

    // Stand-in for an actual call to an LLM provider. Wire this up to
    // OpenAI/Anthropic/etc. in a real project — the rate limiter doesn't
    // care what's behind it, it only cares about the token cost.
    res.json({
      reply: `(demo) received a ${estimateTokens(prompt)}-token prompt.`,
      note: 'This endpoint is limited by estimated token cost, not request count.',
    });

    // Reconciliation idea (left as a comment, not implemented, to keep
    // the demo self-contained): after the real LLM call returns its
    // actual `usage.total_tokens`, call aiLimiter.consume() a second time
    // with (actualTokens - estimatedTokens) as a signed adjustment, or
    // maintain a small "credit" pool, so persistent under/over-estimation
    // doesn't drift the bucket over time.
  }
);

module.exports = router;
