import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addEstimatedTokenUsageFromText,
  addTokenUsage,
  getVisibleTokenUsage,
} from './token-usage.ts';

test('adds estimated output tokens from streamed text', () => {
  const usage = addEstimatedTokenUsageFromText(null, 'hello world', 'output');

  assert.equal(usage.input_tokens, 0);
  assert.ok(usage.output_tokens > 0);
  assert.equal(usage.total_tokens, usage.output_tokens);
});

test('adds estimated input tokens for tool observations without replacing output', () => {
  const outputUsage = addEstimatedTokenUsageFromText(null, 'final answer text', 'output');
  const usage = addEstimatedTokenUsageFromText(outputUsage, 'tool observation content', 'input');

  assert.ok(usage.input_tokens > 0);
  assert.equal(usage.output_tokens, outputUsage.output_tokens);
  assert.equal(usage.total_tokens, usage.input_tokens + usage.output_tokens);
});

test('prefers real token usage over live estimates for visible usage', () => {
  const estimate = { input_tokens: 3, output_tokens: 5, total_tokens: 8 };
  const real = { input_tokens: 20, output_tokens: 10, total_tokens: 30 };

  assert.deepEqual(getVisibleTokenUsage(real, estimate), {
    usage: real,
    isEstimated: false,
  });
});

test('adds real token usage cumulatively', () => {
  assert.deepEqual(
    addTokenUsage(
      { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      { input_tokens: 7, output_tokens: 4, total_tokens: 11 },
    ),
    { input_tokens: 10, output_tokens: 6, total_tokens: 16 },
  );
});
