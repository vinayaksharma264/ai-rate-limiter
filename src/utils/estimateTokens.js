'use strict';

/**
 * Very rough token estimate: ~4 characters per token in English text, which
 * is the same ballpark heuristic OpenAI documents for GPT-style tokenizers.
 * Good enough to gate requests BEFORE calling an upstream LLM; swap this
 * out for a real tokenizer (e.g. `tiktoken`) if you need precision, or
 * reconcile against the actual `usage.total_tokens` the LLM API returns
 * after the call (see routes/ai.js for where that would plug in).
 */
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

module.exports = { estimateTokens };
