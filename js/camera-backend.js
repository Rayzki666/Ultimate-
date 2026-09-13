// Browser camera transport. Coach owns guidance/UI state; this class owns media tracks.
import { captureFrame } from './capture.js';

const VIDEO_CONSTRAINTS = {
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};

function stopTracks(stream) {
  stream?.getTracks?.().forEach(track => track.stop());
}

function facingMode(value) {
  return value === 'user' ? 'user' : 'environment';
}

export class WebCameraBackend {
  constructor({
    mediaDevices = globalThis.navigator?.mediaDevices,
    documentRef = globalThis.document,
    secureContext = globalThis.isSecureContext,
    capture = captureFrame,
  } = {}) {
    this.mediaDevices = mediaDevices;
    this.document = documentRef;
    this.secureContext = Boolean(secureContext);
    this.captureFrame = capture;

    this.video = null;
    this.stream = null;
    this.facing = 'environment';
    this.running = false;
    this.starting = false;
    this._generation = 0;
  }

  get available() {
    return this.secureContext && typeof this.mediaDevices?.getUserMedia === 'function';
  }

  async start(video, { facing = this.facing, onEnded } = {}) {
    const nextFacing = facingMode(facing);
    if (this.running && this.video === video && this.facing === nextFacing) return true;
    if (this.starting) return false;
    if (!this.available) {
      throw new DOMException('Camera access is unavailable.', 'NotSupportedError');
    }
    if (!video) throw new TypeError('A video element is required.');

    if (this.running) this.stop();
    const generation = ++this._generation;
    this.starting = true;
    this.facing = nextFacing;
    let stream = null;

    try {
      stream = await this.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: this.facing }, ...VIDEO_CONSTRAINTS },
        audio: false,
      });
      if (generation !== this._generation || this.document?.hidden) {
        stopTracks(stream);
        return false;
      }

      this.video = video;
      this.stream = stream;
      video.srcObject = stream;
      video.style.transform = this.facing === 'user' ? 'scaleX(-1)' : '';
      await video.play();

      // stop() or a newer start may have happened while permission/play was pending.
      if (generation !== this._generation || this.stream !== stream) {
        stopTracks(stream);
        if (video.srcObject === stream) video.srcObject = null;
        return false;
      }

      this.running = true;
      stream.getVideoTracks?.()[0]?.addEventListener?.('ended', () => {
        if (generation !== this._generation || this.stream !== stream) return;
        this.stop();
        onEnded?.();
      }, { once: true });
      return true;
    } catch (error) {
      if (generation !== this._generation) {
        stopTracks(stream);
        if (video.srcObject === stream) video.srcObject = null;
        return false;
      }
      this.stop();
      throw error;
    } finally {
      if (generation === this._generation) this.starting = false;
    }
  }

  stop() {
    ++this._generation;
    this.starting = false;
    this.running = false;
    const stream = this.stream;
    const video = this.video;
    this.stream = null;
    this.video = null;
    stopTracks(stream);
    if (video?.srcObject === stream) video.srcObject = null;
  }

  flip() {
    this.stop();
    this.facing = this.facing === 'environment' ? 'user' : 'environment';
    return this.facing;
  }

  capture({ width, height, mirror = this.facing === 'user' } = {}) {
    if (!this.video || !this.running) {
      return Promise.reject(new Error('The camera is not ready yet. Please wait.'));
    }
    return this.captureFrame(this.video, width, height, mirror);
  }
}
