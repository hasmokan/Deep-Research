import assert from 'node:assert/strict';
import test from 'node:test';

import { getNextTypewriterText } from './typewriter.ts';

test('getNextTypewriterText reveals the next slice of stable text', () => {
  assert.equal(
    getNextTypewriterText('Structuring source discovery.', '', 4),
    'Stru',
  );
  assert.equal(
    getNextTypewriterText('Structuring source discovery.', 'Stru', 4),
    'Structur',
  );
});

test('getNextTypewriterText restarts when the target text changes', () => {
  assert.equal(
    getNextTypewriterText('Clarifying the research objective.', 'Structuring', 4),
    'Clar',
  );
});
