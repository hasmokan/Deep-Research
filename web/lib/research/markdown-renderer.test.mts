import assert from 'node:assert/strict';
import test from 'node:test';

import { renderMarkdown } from './markdown-renderer.ts';

test('renderMarkdown converts markdown into HTML', () => {
  const html = renderMarkdown('# Report\n\nThis is **important**.');

  assert.match(html, /<h1>Report<\/h1>/);
  assert.match(html, /<strong>important<\/strong>/);
});

test('renderMarkdown escapes raw HTML from model output', () => {
  const html = renderMarkdown('<script>alert("x")</script>');

  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
