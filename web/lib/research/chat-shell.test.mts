import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createConversationTitle,
  getVisibleChatSidebarItems,
} from './chat-shell.ts';

test('getVisibleChatSidebarItems only exposes real saved sessions', () => {
  const items = getVisibleChatSidebarItems([
    { id: 'session-1', title: '阿里巴巴是什么' },
    { id: 'session-2', title: 'New chat' },
  ]);

  assert.deepEqual(items, [
    { id: 'session-1', title: '阿里巴巴是什么' },
    { id: 'session-2', title: 'New chat' },
  ]);
});

test('createConversationTitle shortens long prompts for the sidebar', () => {
  const title = createConversationTitle(
    'Analyze restaurant trends, grocery data, and cuisine popularity to see how eating habits are changing across regions.',
  );

  assert.equal(title, 'Analyze restaurant trends, grocery data...');
});
