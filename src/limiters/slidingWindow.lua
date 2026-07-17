-- Sliding window counter, evaluated atomically inside Redis.
--
-- KEYS[1] = base key, e.g. "ratelimit:sw:ip:1.2.3.4"
-- ARGV[1] = windowMs
-- ARGV[2] = limit
-- ARGV[3] = nowMs
-- ARGV[4] = cost
--
-- Returns: { allowed(0/1), remaining, resetMs }
--
-- This mirrors src/utils/algorithms.js#slidingWindowCalc exactly — that
-- file is unit tested; keep the two in sync if you change the math.
-- State is stored as a hash: { currCount, prevCount, windowId } under
-- KEYS[1], rather than one key per window, to keep this a single atomic
-- read-modify-write.

local key = KEYS[1]
local windowMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local windowId = math.floor(now / windowMs)
local elapsedInCurrent = now % windowMs
local overlapWeight = (windowMs - elapsedInCurrent) / windowMs

local data = redis.call('HMGET', key, 'currCount', 'prevCount', 'windowId')
local currCount = tonumber(data[1]) or 0
local prevCount = tonumber(data[2]) or 0
local stateWindowId = tonumber(data[3])

if stateWindowId == nil then
  stateWindowId = windowId
end

if windowId ~= stateWindowId then
  if windowId == stateWindowId + 1 then
    prevCount = currCount
  else
    prevCount = 0
  end
  currCount = 0
end

local estimated = currCount + prevCount * overlapWeight
local resetMs = windowMs - elapsedInCurrent
local allowed = 0
local remaining

if estimated + cost <= limit then
  allowed = 1
  currCount = currCount + cost
  remaining = math.max(0, math.floor(limit - (estimated + cost)))
else
  remaining = math.max(0, math.floor(limit - estimated))
end

redis.call('HMSET', key, 'currCount', currCount, 'prevCount', prevCount, 'windowId', windowId)
redis.call('PEXPIRE', key, windowMs * 2)

return { allowed, remaining, math.floor(resetMs) }
