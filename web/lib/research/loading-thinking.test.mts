import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getLoadingThinkingMessage,
  loadingThinkingMessages,
} from './loading-thinking.ts';

test('loading thinking messages describe the research process in order', () => {
  assert.ok(loadingThinkingMessages.length >= 4);
  assert.equal(loadingThinkingMessages[0].stage, 'search');
  assert.equal(loadingThinkingMessages.at(-1)?.stage, 'report');
  assert.ok(
    loadingThinkingMessages.every((message) => message.text.length > 20),
  );
});

test('loading thinking message lookup cycles through available messages', () => {
  assert.equal(getLoadingThinkingMessage(0), loadingThinkingMessages[0]);
  assert.equal(
    getLoadingThinkingMessage(loadingThinkingMessages.length),
    loadingThinkingMessages[0],
  );
});
