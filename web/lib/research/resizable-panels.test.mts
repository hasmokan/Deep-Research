import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampPanelWidth,
  getDraggedPanelWidth,
} from './resizable-panels.ts';

test('clampPanelWidth keeps panel width within its allowed range', () => {
  assert.equal(clampPanelWidth(180, { min: 240, max: 520 }), 240);
  assert.equal(clampPanelWidth(360, { min: 240, max: 520 }), 360);
  assert.equal(clampPanelWidth(640, { min: 240, max: 520 }), 520);
});

test('getDraggedPanelWidth grows a left-edge panel when dragged to the right', () => {
  const width = getDraggedPanelWidth({
    edge: 'right',
    startClientX: 300,
    currentClientX: 380,
    startWidth: 300,
    constraints: { min: 240, max: 520 },
  });

  assert.equal(width, 380);
});

test('getDraggedPanelWidth grows a right-edge panel when dragged to the left', () => {
  const width = getDraggedPanelWidth({
    edge: 'left',
    startClientX: 1024,
    currentClientX: 900,
    startWidth: 560,
    constraints: { min: 420, max: 820 },
  });

  assert.equal(width, 684);
});

test('getDraggedPanelWidth clamps dragged widths to the configured limits', () => {
  assert.equal(
    getDraggedPanelWidth({
      edge: 'right',
      startClientX: 300,
      currentClientX: 80,
      startWidth: 300,
      constraints: { min: 240, max: 520 },
    }),
    240,
  );

  assert.equal(
    getDraggedPanelWidth({
      edge: 'left',
      startClientX: 1024,
      currentClientX: 120,
      startWidth: 560,
      constraints: { min: 420, max: 820 },
    }),
    820,
  );
});
