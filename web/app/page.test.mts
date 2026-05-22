import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageSource = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');
const controllerSource = await readFile(new URL('../lib/research/use-research-workspace-controller.ts', import.meta.url), 'utf8');
const clientErrorReportingSource = await readFile(new URL('../lib/research/use-client-error-reporting.ts', import.meta.url), 'utf8');
const workspaceViewSource = await readFile(new URL('../components/research/research-workspace-view.tsx', import.meta.url), 'utf8');
const conversationMessagesSource = await readFile(new URL('../components/research/conversation-messages.tsx', import.meta.url), 'utf8');
const errorStateSource = await readFile(new URL('../components/research/error-state.tsx', import.meta.url), 'utf8');
const globalsSource = await readFile(new URL('./globals.css', import.meta.url), 'utf8');

test('home page reports client-side errors to diagnostics', () => {
  assert.match(pageSource, /useResearchWorkspaceController/);
  assert.match(controllerSource, /useClientErrorReporting/);
  assert.match(clientErrorReportingSource, /reportClientError/);
  assert.match(clientErrorReportingSource, /window\.addEventListener\('error'/);
  assert.match(clientErrorReportingSource, /window\.addEventListener\('unhandledrejection'/);
});

test('home page empty state exposes starter prompt actions', () => {
  assert.match(workspaceViewSource, /STARTER_PROMPTS/);
  assert.match(workspaceViewSource, /onStarterPrompt/);
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
  assert.match(conversationMessagesSource, /ConversationTokenUsageBadge/);
  assert.match(conversationMessagesSource, /getVisibleTokenUsage/);
  assert.match(conversationMessagesSource, /token_usage/);
});

test('agent trace exposes a live token usage meter with breakdown', () => {
  assert.match(conversationMessagesSource, /function ConversationTokenUsageBadge/);
  assert.match(conversationMessagesSource, /function RollingTokenNumber/);
  assert.match(conversationMessagesSource, /aria-live="polite"/);
  assert.match(conversationMessagesSource, /token-usage-number/);
  assert.match(conversationMessagesSource, /token-usage-number-current/);
  assert.match(conversationMessagesSource, /estimated/);
  assert.match(globalsSource, /token-usage-roll-in/);
  assert.match(globalsSource, /translateY\(-85%\)/);
});
