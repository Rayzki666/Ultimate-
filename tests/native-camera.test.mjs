import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeCameraAdapter, nativeCamera } from '../js/native-camera.js';

test('default native camera adapter is disabled', async () => {
  assert.equal(nativeCamera.featureEnabled, false);
  assert.deepEqual(await nativeCamera.getAvailability(), {
    featureEnabled: false,
    pluginAvailable: false,
    videoInputAvailable: false,
    previewImplemented: false,
    captureImplemented: false,
  });
});

test('disabled adapter never loads or calls the native plugin', async () => {
  let loads = 0;
  const camera = createNativeCameraAdapter({
    loadPlugin: async () => { loads += 1; throw new Error('must not load'); },
  });

  assert.deepEqual(await camera.authorizationStatus(), {
    featureEnabled: false,
    camera: 'unavailable',
    canRequest: false,
  });
  assert.deepEqual(await camera.requestPermissions(), {
    featureEnabled: false,
    camera: 'unavailable',
    canRequest: false,
  });
  assert.equal(loads, 0);
});

test('explicitly enabled adapter forwards capability and permission probes', async () => {
  const calls = [];
  const plugin = {
    async getAvailability() {
      calls.push('availability');
      return {
        platform: 'ios',
        videoInputAvailable: true,
        previewImplemented: false,
        captureImplemented: false,
        simulator: false,
      };
    },
    async authorizationStatus() {
      calls.push('status');
      return { camera: 'prompt', canRequest: true };
    },
    async requestPermissions() {
      calls.push('request');
      return { camera: 'granted', canRequest: false };
    },
  };
  const camera = createNativeCameraAdapter({
    enabled: true,
    loadPlugin: async () => plugin,
  });

  assert.deepEqual(await camera.getAvailability(), {
    platform: 'ios',
    videoInputAvailable: true,
    previewImplemented: false,
    captureImplemented: false,
    simulator: false,
    featureEnabled: true,
    pluginAvailable: true,
  });
  assert.deepEqual(await camera.authorizationStatus(), {
    camera: 'prompt',
    canRequest: true,
    featureEnabled: true,
  });
  assert.deepEqual(await camera.requestPermissions(), {
    camera: 'granted',
    canRequest: false,
    featureEnabled: true,
  });
  assert.deepEqual(calls, ['availability', 'status', 'request']);
});

test('missing native bridge returns unavailable metadata without rejecting', async () => {
  const camera = createNativeCameraAdapter({
    enabled: true,
    loadPlugin: async () => { throw new Error('plugin missing'); },
  });

  await assert.doesNotReject(async () => {
    assert.equal((await camera.getAvailability()).pluginAvailable, false);
    assert.deepEqual(await camera.authorizationStatus(), {
      featureEnabled: true,
      camera: 'unavailable',
      canRequest: false,
    });
  });
});
