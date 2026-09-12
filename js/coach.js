// 取景教练：一边看着取景框，一边告诉你此刻最该改的那一件事。
//
// 三层输入：
//   陀螺仪  → 机身歪没歪、镜头是俯是仰
//   像素    → 曝光、光位（认出人之后用她脸上的光，不是画面中心的光）
//   关键点  → 她在画面哪儿、头顶留白、画面下沿有没有切在关节上
//
// 只显示一条。拍照的时候人没空读列表，给三条等于没给。
// 开了语音就把这条念出来——眼睛应该在她身上，不是在手机屏幕上。

import { $, toast, buzz } from './ui.js';
import { Tilt } from './sensors.js';
import { FrameReader, interpret, coverRect, regionFromBox } from './frame.js';
import { SubjectTracker, readSubject, drawSkeleton, coverMapper } from './vision.js';
import { Voice } from './speak.js';
import { SHOT_TYPES, targetFor, assessScene, ReadinessGate } from './guidance.js';
import { getStyle, styleHint } from './styles.js';
import { captureFrame } from './capture.js';
import { store } from './store.js';


const ROLL_TOLERANCE = 2.4;   // 歪超过这个度数就提醒，2° 以上肉眼能看出来
const TIP_HOLD_MS    = 650;   // 提示至少停留这么久，避免抖来抖去
const DETECT_HZ      = 8;    // 关键点检测频率。再高对判断没帮助，只费电

export class Coach {
  constructor() {
    this.video    = $('#cam');
    this.overlay  = $('#overlay');
    this.octx     = this.overlay.getContext('2d');
    this.tilt     = new Tilt();
    this.reader   = new FrameReader();
    this.tracker  = new SubjectTracker();
    this.voice    = new Voice();

    this.stream   = null;
    this.facing   = 'environment';
    this.running  = false;
    this.shotType = 'half';
    this.showGrid = store.prefs.grid !== false;
    this.head     = null;        // 没开自动认人时，手动点的位置
    this.stats    = null;
    this.reading  = null;
    this.subjects = [];
    this.ready    = false;
    this.composition = ['thirds', 'center', 'free'].includes(store.prefs.composition) ? store.prefs.composition : 'thirds';
    this.style = getStyle(store.prefs.styleId);
    this.gate = new ReadinessGate();
    this._targetX = null;
    this._session = 0;
    this._starting = false;
    this._lastPoseAt = -Infinity;
    this._frameSeenAt = -Infinity;
    this._sampleVideoTime = -1;
    this._detectVideoTime = -1;

    this._raf = null;
    this._statTimer = null;
    this._lastDetect = 0;
    this._tip = { key: null, since: 0, shown: null };

    this.overlay.style.pointerEvents = 'auto';
    this.overlay.addEventListener('click', (e) => this._markHead(e));
  }

  // ── 生命周期 ────────────────────────────────────────
  async start() {
    if (this.running) return true;
    if (this._starting) return false;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this._fail('Open this page over HTTPS in a camera-enabled browser. On iPhone, use Safari.');
      return false;
    }
    const session = ++this._session;
    this._starting = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: this.facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      if (session !== this._session || document.hidden) {
        stream.getTracks().forEach(t => t.stop());
        return false;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      this.video.style.transform = this.facing === 'user' ? 'scaleX(-1)' : '';
      await this.video.play();
      if (session !== this._session) return false;
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (session !== this._session) return;
        this.stop();
        this._fail('Camera disconnected. Please open it again.');
      });
      $('#camIdle').hidden = true;
      $('#camError').hidden = true;
      $('#hud').hidden = false;
      $('#camBar').hidden = false;
      $('#camStack').hidden = false;
      document.body.classList.add('cam-on');
      this.running = true;
      if (store.prefs.voice !== false) this._setVoice(true);
      // 已获许可时可以重启监听；第一次权限申请由按钮手势触发。
      if (this.tilt.permission === 'granted' && store.prefs.tilt !== false) this.tilt.start();
      if (store.prefs.track !== false) this.enableTracking();
      this._loop();
      this._sample();
      this._statTimer = setInterval(() => this._sample(), 220);
      return true;
    } catch (err) {
      if (session === this._session) {
        this.stop();
        this._fail(this._explain(err));
      }
      return false;
    } finally {
      if (session === this._session) this._starting = false;
    }
  }

  stop() {
    ++this._session;
    this._starting = false;
    this.running = false;
    cancelAnimationFrame(this._raf);
    clearInterval(this._statTimer);
    this.tilt.stop();
    this.voice.stop();
    this.tracker.dispose();
    this.gate.reset();
    this.reading = null;
    this.stats = null;
    this._targetX = null;
    this._lastPoseAt = -Infinity;
    this._frameSeenAt = -Infinity;
    this._sampleVideoTime = -1;
    this._detectVideoTime = -1;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.head = null;
    this.subjects = [];
    this.ready = false;
    this._tip = { key: null, since: 0, shown: null };
    $('#camIdle').hidden = false;
    $('#hud').hidden = true;
    $('#camBar').hidden = true;
    $('#camStack').hidden = true;
    document.body.classList.remove('cam-on');
    $('#cameraStage')?.classList.remove('is-ready');
    $('#cameraStage').dataset.readiness = 'incomplete';
    $('#shutterCue').textContent = 'Take photo';
    $('#captureNow').setAttribute('aria-label', 'Take photo');
    $('#captureNow').disabled = true;
    $('#btnTrack').disabled = false;
    $('#btnTrack').textContent = 'Detect';
    this.octx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  async flip() {
    this.facing = this.facing === 'environment' ? 'user' : 'environment';
    const wasRunning = this.running;
    this.stop();
    if (wasRunning) {
      const ok = await this.start();
      if (ok && this.facing === 'user') {
        toast('Front camera selected. The saved image matches this mirrored preview.', 3200);
      }
    }
  }

  async enableTilt() {
    const ok = await this.tilt.start();
    if (!this.running) { this.tilt.stop(); return false; }
    const prefs = store.prefs; prefs.tilt = ok; store.prefs = prefs;
    if (!ok) {
      toast(this.tilt.permission === 'denied'
        ? 'Motion access was denied. Check this website permission in Safari and retry.'
        : 'Orientation readings are unavailable on this device.', 4200);
    }
    return ok;
  }

  /** 自动分析默认开启，关闭后记住用户选择。模型加载完成不代表看到了人。 */
  async enableTracking() {
    if (this.tracker.ready) return true;
    if (this.tracker.state === 'loading') return false;
    const session = this._session;
    const btn = $('#btnTrack');
    btn.disabled = true;
    btn.textContent = 'Loading';
    const ok = await this.tracker.load();
    if (session !== this._session || !this.running) return false;
    btn.disabled = false;
    btn.textContent = ok ? 'Detect' : 'Retry';
    btn.setAttribute('aria-pressed', String(ok));
    if (ok) {
      this.head = null;
      const prefs = store.prefs; prefs.track = true; store.prefs = prefs;
    } else {
      toast('Subject detection is unavailable. Retry or take a photo anytime.', 3500);
    }
    this._updateHud();
    return ok;
  }

  disableTracking() {
    this.tracker.dispose();
    this.subjects = [];
    this.gate.reset();
    this._lastPoseAt = -Infinity;
    this._updateHud();
    const prefs = store.prefs; prefs.track = false; store.prefs = prefs;
  }

  _setVoice(on) {
    const enabled = this.voice.toggle(on);
    const prefs = store.prefs; prefs.voice = enabled; store.prefs = prefs;
    if (enabled && !this.voice.supported) {
      toast('Voice guidance is unavailable in this browser.');
      return false;
    }
    return enabled;
  }

  toggleVoice() { return this._setVoice(!this.voice.enabled); }

  setStyle(id) {
    this.style = getStyle(id);
    this.voice.stop();
    this.ready = false;
    this._tip = { key: null, since: 0, shown: null };
    this._targetX = null;
    this.gate.reset();
    if (this.style) {
      this.shotType = this.style.shotType;
      this.composition = this.style.composition;
    }
    const prefs = store.prefs;
    prefs.styleId = this.style?.id || null;
    prefs.composition = this.composition;
    store.prefs = prefs;
    $('#cameraStage').classList.remove('is-ready');
    if (this.running) this._updateHud();
  }

  setShotType(type) {
    if (SHOT_TYPES[type]) {
      this.shotType = type;
      this._targetX = null;
      this.gate.reset();
      if (this.running) this._updateHud();
    }
  }

  setComposition(value) {
    if (!['thirds', 'center', 'free'].includes(value)) return;
    this.composition = value;
    this._targetX = null;
    this.gate.reset();
    const prefs = store.prefs; prefs.composition = value; store.prefs = prefs;
    if (this.running) this._updateHud();
  }

  async capture() {
    if (!this.running || performance.now() - this._frameSeenAt > 750) {
      throw new Error('The camera is not ready yet. Please wait.');
    }
    const { w, h } = this._box;
    const shot = await captureFrame(this.video, w, h, this.facing === 'user');
    this.gate.reset();
    this.ready = false;
    $('#cameraStage').classList.remove('is-ready');
    if (this.running) this._updateHud();
    return shot;
  }

  toggleGrid() {
    this.showGrid = !this.showGrid;
    const prefs = store.prefs; prefs.grid = this.showGrid; store.prefs = prefs;
    return this.showGrid;
  }

  // ── 采样 ────────────────────────────────────────────
  get _box() {
    return { w: this.overlay.clientWidth || 1, h: this.overlay.clientHeight || 1 };
  }

  _sample() {
    if (!this.running) return;
    const now = performance.now();
    if (this.video.currentTime !== this._sampleVideoTime) {
      this._sampleVideoTime = this.video.currentTime;
      this._frameSeenAt = now;
    }
    if (now - this._lastPoseAt > 500) this.subjects = [];
    if (this.video.readyState < 2 || now - this._frameSeenAt > 750) {
      this.reading = null;
      this.subjects = [];
      $('#captureNow').disabled = true;
      this._updateHud();
      return;
    }
    $('#captureNow').disabled = false;
    const { w, h } = this._box;
    const crop = coverRect(this.video, w, h);

    const stats = this.reader.read(this.video, crop);
    if (stats) {
      // 认出人就用她脸上的光判逆光，比拿画面中心当主体准得多
      let faceLuma = null;
      const s0 = this.subjects[0];
      if (s0?.face) {
        const rect = regionFromBox(s0.face, crop, this.facing === 'user');
        if (rect) faceLuma = this.reader.readRegion(this.video, rect);
      }
      this.stats = stats;
      this.reading = interpret(stats, faceLuma);
    } else {
      this.reading = null;
      this.stats = null;
    }
    this._updateHud();
  }

  _detect(now) {
    if (!this.tracker.ready || this.video.readyState < 2 || this.video.currentTime === this._detectVideoTime || now - this._lastDetect < 1000 / DETECT_HZ) return;
    this._detectVideoTime = this.video.currentTime;
    this._lastDetect = now;

    const raw = this.tracker.detect(this.video, now);
    this._lastPoseAt = now;
    if (!raw) { this.subjects = []; return; }

    const { w, h } = this._box;
    const map = coverMapper(this.video, w, h, this.facing === 'user');
    this.subjects = raw
      .map(pts => {
        const mapped = pts.map(p => ({ ...map(p), z: p.z, visibility: p.visibility }));
        const s = readSubject(mapped);
        return s ? { ...s, pts: mapped } : null;
      })
      .filter(s => s && s.head.x >= 0 && s.head.x <= 1 && s.head.y >= 0 && s.head.y <= 1)
      .sort((a, b) => area(b.box) - area(a.box));
  }

  // ── 抬头显示 ────────────────────────────────────────
  _updateHud() {
    const rawTilt = this.tilt.read();
    const t = rawTilt && { ...rawTilt, pitch: this.facing === 'user' ? -rawTilt.pitch : rawTilt.pitch };
    const r = this.reading;

    const setChip = (sel, value, level) => {
      const chip = $(sel);
      chip.querySelector('.chip-v').textContent = value;
      chip.className = 'chip' + (level ? ' is-' + level : '');
    };

    if (t && t.rollValid) {
      const a = Math.abs(t.roll);
      setChip('#chipLevel', `${t.roll > 0 ? 'R ' : t.roll < 0 ? 'L ' : ''}${a.toFixed(1)}°`,
              a <= ROLL_TOLERANCE ? 'good' : a <= 5 ? 'warn' : 'bad');
    } else {
      setChip('#chipLevel', t ? '—' : 'Off', null);
    }

    if (t) {
      const p = Math.round(t.pitch);
      const spec = SHOT_TYPES[this.shotType];
      const inRange = p >= spec.lo && p <= spec.hi;
      setChip('#chipPitch', `${p > 1 ? 'Down ' : p < -1 ? 'Up ' : 'Level '}${Math.abs(p)}°`,
              inRange ? 'good' : Math.abs(p - (p > spec.hi ? spec.hi : spec.lo)) < 7 ? 'warn' : 'bad');
    } else {
      setChip('#chipPitch', 'Off', null);
    }

    if (r) {
      setChip('#chipLight', `${r.light.label}·${r.exposure.label}`,
              r.exposure.level === 'bad' ? 'bad'
              : r.exposure.level === 'warn' || r.light.level === 'warn' ? 'warn' : 'good');
    } else {
      setChip('#chipLight', 'Not measured', null);
    }

    const chipS = $('#chipSubject');
    if (this.tracker.ready) {
      const n = this.subjects.length;
      chipS.hidden = false;
      setChip('#chipSubject', n === 0 ? 'No subject' : n === 1 ? '1 person' : `${n} people`,
              n === 0 ? 'warn' : 'good');
    } else {
      chipS.hidden = true;
    }

    this._pickTip(t, r);
  }

  _pickTip(t, r) {
    if (!this.running) return;
    const now = performance.now();
    const subjects = now - this._lastPoseAt <= 500 ? this.subjects : [];
    if (this._targetX === null && subjects.length) {
      this._targetX = targetFor(this.composition, this.shotType, subjects[0].head.x);
    }
    const assessment = assessScene({
      reading: r, tilt: t, subjects, shotType: this.shotType, style: this.style,
      targetX: this._targetX, tracking: this.tracker.state,
      manual: !subjects.length && Boolean(this.head), mirror: this.facing === 'user',
    });
    const wasReady = this.ready;
    const state = this.gate.update({ now, eligible: assessment.eligible,
      subjects: subjects.slice(0, this.shotType === 'duo' ? 2 : 1) });
    this.ready = state.ready;
    let tip = assessment.tip || (state.ready
      ? { key: 'ready', sev: 'ready', icon: '✓', text: 'Ready to shoot',
          reason: t ? 'Measured light and framing are steady. Capture this moment.' : 'Light and framing are steady. Camera angle is not measured.', voice: 'Ready to shoot' }
      : { key: 'steady', sev: 'good', icon: '◎', text: 'Hold this frame',
          reason: 'Keep the subject and camera steady for a moment.', voice: '' });
    const styleNote = styleHint(this.style, this.stats, r);
    $('#styleLiveNote').textContent = styleNote;
    if (!assessment.tip && this.style && !state.ready) tip.reason = styleNote;
    if (state.ready) tip.reason = 'Pose basics, angle, light and framing checked. Press the glowing shutter.';
    const readiness = state.ready ? 'ready' : assessment.eligible ? 'steady' :
      Object.values(assessment.checks).includes('warn') ? 'adjust' : 'incomplete';
    this._showTip(tip, wasReady, state.progress, { ...assessment.checks, steady: state.ready ? 'good' : assessment.eligible ? 'pending' : 'unknown' }, readiness);
  }

  _showTip(tip, wasReady, progress, checks, readiness) {
    const now = performance.now();
    if (tip.key !== this._tip.key) this._tip = { key: tip.key, since: now, shown: this._tip.shown };
    const old = this._tip.shown;
    // 只对不同的纠正建议做迟滞；绝不延迟撤销绿灯，也不保留过期的方向。
    if (old && old.sev === 'warn' && tip.sev === 'warn' &&
        old.key !== tip.key && now - this._tip.since < TIP_HOLD_MS &&
        old.key.split('-')[0] !== tip.key.split('-')[0]) tip = old;
    else this._tip.shown = tip;
    const box = $('#coachTip');
    box.hidden = false;
    box.className = 'coach-tip sev-' + tip.sev;
    if ($('#coachTipText').textContent !== tip.text) $('#coachTipText').textContent = tip.text;
    $('#coachTipIcon').textContent = tip.icon;
    $('#coachTipReason').textContent = tip.reason;
    $('#cameraStage').classList.toggle('is-ready', this.ready);
    $('#cameraStage').dataset.readiness = readiness;
    const statusTitles = { ready: 'READY TO SHOOT', steady: 'HOLD STEADY', adjust: 'ONE MORE ADJUSTMENT', incomplete: 'CHECKS INCOMPLETE' };
    $('#readinessTitle').textContent = statusTitles[readiness];
    $('#readinessCount').textContent = Object.values(checks).filter(s => s === 'good').length + ' / 5 checks';
    $('#shutterCue').textContent = this.ready ? 'SHOOT NOW' : 'Take photo';
    $('#captureNow').setAttribute('aria-label', this.ready ? 'Ready — take photo' : 'Take photo');
    $('#readyProgress').value = progress;
    $('#readyProgress').setAttribute('aria-valuetext', this.ready ? 'Steady and ready to shoot' : 'Waiting for sustained stability');
    $('#coachState').textContent = this.ready ? 'Ready to shoot' : tip.key === 'steady' ? 'Hold steady' : 'Live guidance';
    for (const [key, label] of [['pose', 'Pose'], ['angle', 'Angle'], ['light', 'Light'], ['framing', 'Frame'], ['steady', 'Steady']]) {
      const item = $('#check-' + key);
      item.dataset.state = checks[key];
      item.textContent = (checks[key] === 'good' ? '✓ ' : checks[key] === 'warn' ? '! ' : checks[key] === 'pending' ? '◷ ' : '○ ') + label;
      item.setAttribute('aria-label', label + ': ' + (checks[key] === 'good' ? 'passed' : checks[key] === 'warn' ? 'adjust' : checks[key] === 'pending' ? 'hold steady' : 'not checked'));
    }
    if ((wasReady && !this.ready) || (old && old.key !== tip.key)) this.voice.stop();
    if (this.ready && !wasReady) {
      buzz([25, 45, 25]);
      this.voice.say(tip.voice);
    } else if (!this.ready && (tip.sev === 'warn' || tip.sev === 'bad')) {
      this.voice.say(tip.voice);
    }
  }

  _markHead(e) {
    if (!this.running || this.tracker.ready) return;   // 认得出人就不用手动点了
    const rect = this.overlay.getBoundingClientRect();
    this.head = {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
    buzz(18);
    this._updateHud();
  }

  // ── 叠加层 ──────────────────────────────────────────
  _loop() {
    if (!this.running) return;
    const now = performance.now();
    this._detect(now);
    this._draw();
    this._raf = requestAnimationFrame(() => this._loop());
  }

  _draw() {
    const cv = this.overlay;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w * dpr || cv.height !== h * dpr) {
      cv.width = w * dpr; cv.height = h * dpr;
    }
    const g = this.octx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    if (this.showGrid) this._drawGrid(g, w, h);

    for (const s of this.subjects) {
      drawSkeleton(g, s.pts, p => p, w, h,
                   this.ready ? 'rgba(74,222,128,.85)' : 'rgba(255,138,91,.8)');
      this._drawHeadMark(g, w, h, s.head.x, s.head.y, s.headTop);
    }
    if (!this.subjects.length && this.head) {
      this._drawHeadMark(g, w, h, this.head.x, this.head.y, null);
    }

    const t = this.tilt.read();
    if (t && t.rollValid) this._drawLevel(g, w, h, t.roll);
  }

  _drawGrid(g, w, h) {
    if (this.composition === 'free') return;
    const columns = this.composition === 'center' || this.shotType === 'close' || this.shotType === 'duo' ? [0.5] : [1 / 3, 2 / 3];
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(255,255,255,.26)';
    g.beginPath();
    for (const x of columns) { g.moveTo(w * x, 0); g.lineTo(w * x, h); }
    for (const y of [1 / 3, 2 / 3]) { g.moveTo(0, h * y); g.lineTo(w, h * y); }
    g.stroke();

    g.fillStyle = 'rgba(255,138,91,.85)';
    for (const px of columns) {
      for (const py of [1 / 3, 2 / 3]) {
        g.beginPath(); g.arc(w * px, h * py, 3, 0, Math.PI * 2); g.fill();
      }
    }

    g.strokeStyle = 'rgba(255,255,255,.16)';
    g.setLineDash([5, 6]);
    g.beginPath(); g.moveTo(0, h * 0.14); g.lineTo(w, h * 0.14); g.stroke();
    g.setLineDash([]);
  }

  _drawHeadMark(g, w, h, hx, hy, headTop) {
    const x = hx * w, y = hy * h;
    g.strokeStyle = this.ready ? 'rgba(74,222,128,.95)' : 'rgba(255,138,91,.95)';
    g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, 15, 0, Math.PI * 2); g.stroke();

    // 头顶留白：画一条线到头顶，一眼能看出上面空了多少
    if (headTop !== null && headTop > 0) {
      g.setLineDash([3, 4]);
      g.beginPath(); g.moveTo(x, headTop * h); g.lineTo(x, 0); g.stroke();
      g.setLineDash([]);
    }

    const target = this.shotType === 'duo' ? null : this._targetX;
    if (target !== null && Math.abs(hx - target) > 0.05) {
      g.strokeStyle = 'rgba(255,138,91,.55)';
      g.setLineDash([4, 5]);
      g.beginPath(); g.moveTo(x, y); g.lineTo(w * target, y); g.stroke();
      g.setLineDash([]);
      g.beginPath(); g.arc(w * target, y, 19, 0, Math.PI * 2); g.stroke();
    }
  }

  _drawLevel(g, w, h, roll) {
    const cx = w / 2, cy = h / 2;
    const half = Math.min(w * 0.3, 130);
    const ok = Math.abs(roll) <= ROLL_TOLERANCE;
    const rad = (-roll * Math.PI) / 180;

    g.strokeStyle = 'rgba(255,255,255,.34)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(cx - half, cy); g.lineTo(cx - half * 0.42, cy);
    g.moveTo(cx + half * 0.42, cy); g.lineTo(cx + half, cy);
    g.stroke();

    g.strokeStyle = ok ? 'rgba(74,222,128,.95)' : 'rgba(255,138,91,.95)';
    g.lineWidth = 2.5;
    g.save();
    g.translate(cx, cy); g.rotate(rad);
    g.beginPath();
    g.moveTo(-half * 0.38, 0); g.lineTo(half * 0.38, 0);
    g.stroke();
    g.restore();

    if (ok) {
      g.fillStyle = 'rgba(74,222,128,.95)';
      g.beginPath(); g.arc(cx, cy, 3.5, 0, Math.PI * 2); g.fill();
    }
  }

  // ── 错误 ────────────────────────────────────────────
  _explain(err) {
    switch (err?.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Camera access was denied. Allow Camera in Safari website settings, then try again.';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'No camera is available.';
      case 'NotReadableError':
        return 'The camera is busy. Close other camera apps and try again.';
      default:
        return 'Unable to open the camera: ' + (err?.message || err?.name || 'Unknown error');
    }
  }

  _fail(msg) {
    $('#camIdle').hidden = true;
    $('#camError').hidden = false;
    $('#camErrorMsg').textContent = msg;
  }
}

function area(b) {
  return b ? Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0) : 0;
}

export { SHOT_TYPES };
