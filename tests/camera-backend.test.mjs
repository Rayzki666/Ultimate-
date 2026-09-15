import test from 'node:test';
import assert from 'node:assert/strict';
import { WebCameraBackend } from '../js/camera-backend.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
}

function fakeStream() {
  const ended = [];
  const track = {
    stopped: 0,
    stop() { this.stopped += 1; },
    addEventListener(type, listener) { if (type === 'ended') ended.push(listener); },
  };
  return {
    track,
    ended,
    getTracks: () => [track],
    getVideoTracks: () => [track],
  };
}

function fakeVideo() {
  return {
    srcObject: null,
    style: {},
    playCalls: 0,
    async play() { this.playCalls += 1; },
  };
}

test('web backend starts, mirrors, captures, and releases its track', async () => {
  const stream = fakeStream();
  const requested = [];
  const captures = [];
  const video = fakeVideo();
  const backend = new WebCameraBackend({
    secureContext: true,
    documentRef: { hidden: false },
    mediaDevices: { getUserMedia: async constraints => { requested.push(constraints); return stream; } },
    capture: async (...args) => { captures.push(args); return { blob: 'jpeg', width: 3, height: 4 }; },
  });

  assert.equal(await backend.start(video, { facing: 'user' }), true);
  assert.equal(backend.running, true);
  assert.equal(backend.stream, stream);
  assert.equal(video.srcObject, stream);
  assert.equal(video.style.transform, 'scaleX(-1)');
  assert.equal(requested[0].audio, false);
  assert.equal(requested[0].video.facingMode.ideal, 'user');

  assert.deepEqual(await backend.capture({ width: 390, height: 650 }), { blob: 'jpeg', width: 3, height: 4 });
  assert.deepEqual(captures[0], [video, 390, 650, true]);

  backend.stop();
  assert.equal(stream.track.stopped, 1);
  assert.equal(video.srcObject, null);
  assert.equal(backend.stream, null);
  assert.equal(backend.running, false);
});

test('flip releases the active track and changes the requested camera', async () => {
  const stream = fakeStream();
  const video = fakeVideo();
  const backend = new WebCameraBackend({
    secureContext: true,
    documentRef: { hidden: false },
    mediaDevices: { getUserMedia: async () => stream },
  });

  await backend.start(video);
  assert.equal(backend.flip(), 'user');
  assert.equal(stream.track.stopped, 1);
  assert.equal(video.srcObject, null);
  assert.equal(backend.running, false);
});

test('a stopped pending start cannot reactivate the camera', async () => {
  const pending = deferred();
  const stream = fakeStream();
  const video = fakeVideo();
  const backend = new WebCameraBackend({
    secureContext: true,
    documentRef: { hidden: false },
    mediaDevices: { getUserMedia: () => pending.promise },
  });

  const starting = backend.start(video);
  backend.stop();
  pending.resolve(stream);

  assert.equal(await starting, false);
  assert.equal(stream.track.stopped, 1);
  assert.equal(video.srcObject, null);
  assert.equal(backend.stream, null);
  assert.equal(backend.running, false);
});

test('a stale start cannot clear or replace a newer session', async () => {
  const first = deferred();
  const second = deferred();
  const oldStream = fakeStream();
  const newStream = fakeStream();
  const video = fakeVideo();
  let request = 0;
  const backend = new WebCameraBackend({
    secureContext: true,
    documentRef: { hidden: false },
    mediaDevices: { getUserMedia: () => (++request === 1 ? first.promise : second.promise) },
  });

  const oldStart = backend.start(video);
  backend.stop();
  const newStart = backend.start(video, { facing: 'user' });
  second.resolve(newStream);
  assert.equal(await newStart, true);
  first.resolve(oldStream);
  assert.equal(await oldStart, false);

  assert.equal(oldStream.track.stopped, 1);
  assert.equal(newStream.track.stopped, 0);
  assert.equal(backend.stream, newStream);
  assert.equal(video.srcObject, newStream);
  assert.equal(backend.facing, 'user');
  assert.equal(backend.running, true);
});

test('only the active video track can end the session', async () => {
  const stream = fakeStream();
  const video = fakeVideo();
  let ended = 0;
  const backend = new WebCameraBackend({
    secureContext: true,
    documentRef: { hidden: false },
    mediaDevices: { getUserMedia: async () => stream },
  });

  await backend.start(video, { onEnded: () => { ended += 1; } });
  stream.ended[0]();

  assert.equal(ended, 1);
  assert.equal(stream.track.stopped, 1);
  assert.equal(backend.running, false);
  assert.equal(backend.stream, null);
});
