import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageSource = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');

test('home page keeps the skills manager reachable from the app shell', () => {
  assert.match(pageSource, /SkillManagerPanel/);
  assert.match(pageSource, /isSkillManagerOpen/);
  assert.match(pageSource, /setSkillManagerOpen\(true\)/);
});

test('home page empty state exposes starter prompt actions', () => {
  assert.match(pageSource, /STARTER_PROMPTS/);
  assert.match(pageSource, /handleStarterPrompt/);
});
