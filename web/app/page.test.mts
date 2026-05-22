import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageSource = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');
const errorStateSource = await readFile(new URL('../components/research/error-state.tsx', import.meta.url), 'utf8');

test('home page reports client-side errors to diagnostics', () => {
  assert.match(pageSource, /reportClientError/);
  assert.match(pageSource, /window\.addEventListener\('error'/);
  assert.match(pageSource, /window\.addEventListener\('unhandledrejection'/);
});

test('home page empty state exposes starter prompt actions', () => {
  assert.match(pageSource, /STARTER_PROMPTS/);
  assert.match(pageSource, /handleStarterPrompt/);
});

test('error state renders as an inline assistant failure instead of a global error card', () => {
  assert.doesNotMatch(errorStateSource, /Something went wrong/);
  assert.doesNotMatch(errorStateSource, /Common solutions/);
  assert.doesNotMatch(errorStateSource, /github\.com/);
  assert.match(errorStateSource, /role="status"/);
  assert.match(errorStateSource, /This response stopped/);
  assert.match(errorStateSource, /Error ID/);
  assert.match(errorStateSource, /Direct answer/);
});

test('agent trace displays token usage when the backend streams it', () => {
  assert.match(pageSource, /ConversationTokenUsageBadge/);
  assert.match(pageSource, /getVisibleTokenUsage/);
  assert.match(pageSource, /token_usage/);
});

test('agent trace exposes a live token usage meter with breakdown', () => {
  assert.match(pageSource, /function ConversationTokenUsageBadge/);
  assert.match(pageSource, /function RollingTokenNumber/);
  assert.match(pageSource, /aria-live="polite"/);
  assert.match(pageSource, /token-usage-number/);
  assert.match(pageSource, /previous/);
  assert.match(pageSource, /estimated/);
});
