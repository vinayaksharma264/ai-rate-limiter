-- Token bucket, evaluated atomically inside Redis so concurrent requests
-- from the same client can never race each other (no separate GET then SET).
--
-- KEYS[1] = bucket key, e.g. "ratelimit:tb:user:42"
-- ARGV[1] = capacity (max tokens)
-- ARGV[2] = refillRatePerSec
-- ARGV[3] = nowMs
-- ARGV[4] = cost
--
-- Returns: { allowed(0/1), tokensRemaining, retryAfterMs }
--
-- This mirrors src/utils/algorithms.js#tokenBucketCalc exactly — that file
-- is unit tested; keep the two in sync if you change the math.

local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillRatePerSec = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

if cost > capacity then
  return { 0, 0, -1 }
end

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local lastRefill = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  lastRefill = now
end

local elapsedSec = math.max(0, now - lastRefill) / 1000
local refilled = math.min(capacity, tokens + elapsedSec * refillRatePerSec)

local allowed = 0
local retryAfterMs = 0

if refilled >= cost then
  allowed = 1
  refilled = refilled - cost
else
  local deficit = cost - refilled
  retryAfterMs = math.ceil((deficit / refillRatePerSec) * 1000)
end

redis.call('HMSET', key, 'tokens', refilled, 'ts', now)
-- Auto-expire an idle bucket once it would have fully refilled anyway,
-- plus a small buffer, so we don't keep state around forever for clients
-- who never come back.
local ttlSec = math.ceil(capacity / refillRatePerSec) + 60
redis.call('EXPIRE', key, ttlSec)

return { allowed, math.floor(refilled), retryAfterMs }
