import test from 'node:test';
import assert from 'node:assert/strict';
import { createShootReadySignal, signalShootReady } from '../js/native.js';

test('native haptic adapter is a no-op without a Capacitor bridge', async () => {
  assert.equal(await signalShootReady(), false);
});

test('native haptic fires on entry and respects the cooldown', async () => {
  let time = 10_000;
  let calls = 0;
  const signal = createShootReadySignal({
    isNative: () => true,
    now: () => time,
    impact: async () => { calls += 1; },
  });

  assert.equal(await signal(), true);
  assert.equal(calls, 1);

  time += 1499;
  assert.equal(await signal(), false);
  assert.equal(calls, 1);

  time += 1;
  assert.equal(await signal(), true);
  assert.equal(calls, 2);
});

test('native haptic failures resolve safely without an unhandled rejection', async () => {
  const signal = createShootReadySignal({
    isNative: () => true,
    impact: async () => { throw new Error('plugin unavailable'); },
    debug: () => false,
  });

  await assert.doesNotReject(async () => {
    assert.equal(await signal(), false);
  });
});
