import assert from 'node:assert/strict';
import test from 'node:test';

import { getAuthCallbackRedirectPath } from './callback-redirect.ts';

test('getAuthCallbackRedirectPath sends eyjamini production traffic to the ds route', () => {
  assert.equal(getAuthCallbackRedirectPath('https://eyjamini.com'), '/ds');
});

test('getAuthCallbackRedirectPath keeps localhost traffic on the root route', () => {
  assert.equal(getAuthCallbackRedirectPath('http://localhost:3000'), '/');
});
