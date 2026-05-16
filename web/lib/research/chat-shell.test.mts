import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chatSidebarRecents,
  createConversationTitle,
} from './chat-shell.ts';

test('chatSidebarRecents provides a focused research-first recent list', () => {
  assert.ok(chatSidebarRecents.length >= 6);
  assert.equal(chatSidebarRecents[0], 'Eating Habits Analysis');
  assert.ok(chatSidebarRecents.includes('Gstack与Superpowers对比'));
});

test('createConversationTitle shortens long prompts for the sidebar', () => {
  const title = createConversationTitle(
    'Analyze restaurant trends, grocery data, and cuisine popularity to see how eating habits are changing across regions.',
  );

  assert.equal(title, 'Analyze restaurant trends, grocery data...');
});
