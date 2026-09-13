import test from 'node:test';
import assert from 'node:assert/strict';
import { signalShootReady } from '../js/native.js';

test('native haptic adapter is a no-op without a Capacitor bridge', async () => {
  assert.equal(await signalShootReady(), false);
});
