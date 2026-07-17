# ai-rate-limiter

A Redis-backed rate limiter with two modes:

- **General mode** — classic "N requests per M seconds" limiting, for normal API endpoints.
- **AI mode** — variable-cost limiting keyed on estimated/actual LLM token usage, so a single client can't blow through your OpenAI/Anthropic budget with one giant prompt even while staying "under" a naive request-count limit.

Built to be portfolio-readable: the rate-limiting math is implemented twice on purpose — once as plain, dependency-free JS functions (unit tested, no infra needed) and once as Redis Lua scripts (atomic, race-free, used in production) — with the JS version acting as the executable spec for the Lua.

## Why two algorithms

| | Sliding Window Counter | Token Bucket |
|---|---|---|
| Used for | `/api/general/*` | `/api/ai/*` |
| Cost per request | Fixed (1) | Variable (caller-supplied) |
| Good for | "100 requests/minute" style API limits | Metering a resource that isn't 1-unit-per-call, like tokens, bytes, or $ |
| Storage | One hash per client (current + previous window counts) | One hash per client (tokens + last refill time) |
| Burst behavior | Smooths the boundary between fixed windows (approximates a true sliding log cheaply) | Allows bursts up to `capacity`, then throttles to the refill rate |

Both are implemented as **Lua scripts executed atomically inside Redis** (via `EVAL`/`defineCommand`), not as separate `GET` + application logic + `SET` calls. That matters: without atomicity, two concurrent requests from the same client can both read the same "tokens remaining" value before either writes back, and both get allowed when only one should have been — a classic race condition in naive rate limiter implementations.

## Architecture

```
src/
  server.js              Express app wiring
  config.js               env-driven config
  redis/client.js         ioredis client + registers the Lua scripts as commands
  limiters/
    tokenBucket.lua        the actual atomic Redis logic (AI mode)
    tokenBucket.js          thin JS class wrapping the Lua command
    slidingWindow.lua      the actual atomic Redis logic (general mode)
    slidingWindow.js        thin JS class wrapping the Lua command
  middleware/
    rateLimit.js           Express middleware: consumes from a limiter, sets headers, returns 429
  routes/
    general.js              /api/general/ping — sliding window, cost = 1
    ai.js                    /api/ai/chat — token bucket, cost = estimated prompt tokens + completion allowance
  utils/
    algorithms.js           pure, unit-tested reference implementations of both algorithms
    estimateTokens.js       chars/4 token estimate heuristic
tests/
  unit/algorithms.test.js         no infra required — tests the pure math
  integration/limiters.test.js    requires Redis — tests the real Lua scripts end to end
scripts/
  demo.js                  hits both endpoints repeatedly so you can watch 200s turn into 429s
```

## Design decisions worth knowing (for interview conversations)

- **Fail open, not closed.** If Redis is unreachable, `rateLimit.js` logs the error and lets the request through rather than taking your whole API down because the limiter's dependency is unhealthy. Whether that's the right tradeoff is genuinely debatable (fail-closed is more "correct" for abuse prevention) — it's set up as an explicit, visible choice, not an accident.
- **Atomicity via Lua, not `MULTI`/`WATCH`.** A `WATCH`-based optimistic-lock approach also works but requires client-side retry loops under contention; a single `EVAL` call is simpler and strictly atomic since Redis executes it single-threaded.
- **TTLs on every key.** Idle clients' state expires automatically (token bucket: time-to-full-refill + buffer; sliding window: 2x window size) so the limiter doesn't leak memory for clients who show up once and never return.
- **Token cost is estimated before the LLM call, not metered after.** This is the only way to actually prevent an over-budget call from going out — you have to gate on an estimate. The code includes a comment on where you'd reconcile against the real `usage.total_tokens` an LLM API returns, without fully implementing a credit-adjustment system (noted as a possible extension, not built, to keep scope honest).
- **Pure functions extracted from I/O.** `src/utils/algorithms.js` has zero Redis/Express dependencies, so the actual rate-limiting math is fully unit-testable without spinning up infrastructure. The Lua scripts are comment-annotated as mirroring this file.

## Running it

```bash
npm install
docker compose up -d        # starts Redis on :6379
cp .env.example .env
npm start                   # server on :3000
```

In another terminal:
```bash
npm run demo                # fires a burst of requests at both endpoints
```

You should see the first several requests return `200`, then `429` once the limit/bucket is exhausted, with `X-RateLimit-Remaining` counting down in between.

## API

### `GET /api/general/ping`
Sliding window, 100 requests/minute per IP by default (`GENERAL_WINDOW_MS`, `GENERAL_LIMIT`).

```bash
curl -i http://localhost:3000/api/general/ping
```

### `POST /api/ai/chat`
Token bucket, 10,000 token capacity refilling at 200 tokens/sec per IP by default (`AI_TOKEN_CAPACITY`, `AI_TOKEN_REFILL_PER_SEC`). Cost = estimated prompt tokens + a 256-token completion allowance.

```bash
curl -i -X POST http://localhost:3000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Explain rate limiting like I am five."}'
```

Both return standard headers:
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `Retry-After` (only on `429`)

## Testing

```bash
npm test                 # unit tests, no infra needed (12 tests over the pure algorithm functions)
docker compose up -d
npm run test:integration # hits real Redis, exercises the actual Lua scripts
```

## Possible extensions (not implemented, listed for honesty about scope)

- Per-API-key limits instead of per-IP (swap `keyGenerator`)
- A `/admin/limits/:id` endpoint to inspect or reset a client's current bucket/window state
- Distributed rate limiting across multiple Redis nodes (cluster-aware key hashing)
- Real tokenizer (`tiktoken`) instead of the chars/4 heuristic for exact cost accounting
- Post-call reconciliation against actual LLM `usage.total_tokens`

## License

MIT
