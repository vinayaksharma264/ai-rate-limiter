'use strict';

/**
 * Fires a burst of requests at both endpoints so you can literally watch
 * responses flip from 200 to 429. Requires the server (and Redis) to
 * already be running: `npm start` in one terminal, `node scripts/demo.js`
 * in another.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function hammerGeneral(count) {
  console.log(`\n--- /api/general/ping x${count} (sliding window, 100/min default) ---`);
  for (let i = 0; i < count; i++) {
    const res = await fetch(`${BASE_URL}/api/general/ping`);
    const remaining = res.headers.get('x-ratelimit-remaining');
    console.log(`#${i + 1}: ${res.status}  remaining=${remaining}`);
  }
}

async function hammerAi(count) {
  console.log(`\n--- /api/ai/chat x${count} (token bucket, cost = prompt tokens + 256) ---`);
  const longPrompt = 'Explain rate limiting algorithms in detail. '.repeat(20); // chunky prompt
  for (let i = 0; i < count; i++) {
    const res = await fetch(`${BASE_URL}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: longPrompt }),
    });
    const remaining = res.headers.get('x-ratelimit-remaining');
    console.log(`#${i + 1}: ${res.status}  remaining=${remaining}`);
  }
}

(async () => {
  await hammerGeneral(15);
  await hammerAi(15);
})().catch((err) => {
  console.error('Demo failed — is the server running? (npm start)', err.message);
  process.exit(1);
});
