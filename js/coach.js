// 取景教练：把陀螺仪和画面分析合成「此刻最该改的那一件事」。
//
// 设计上只显示一条提示。拍照的时候人没空读列表，给三条等于没给。

import { $, toast, buzz } from './ui.js';
import { Tilt } from './sensors.js';
import { FrameReader, interpret } from './frame.js';
import { store } from './store.js';

const SHOT_TYPES = {
  full:  { label: '全身', lo: -4, hi:  5,
           over:  '手机放低到腰这么高。现在是俯拍，腿会显短一截。',
           under: '仰得太狠了，身体会往后倒。' },
  half:  { label: '半身', lo:  1, hi: 11,
           over:  '俯得有点多，会显头大身子小。收一点。',
           under: '别从下往上拍——下巴和鼻孔会很明显。镜头抬到比她眼睛略高。' },
  close: { label: '特写', lo:  4, hi: 17,
           over:  '太俯了，额头会变大。',
           under: '抬高一点，比她眼睛高一点点再往下拍，脸会小、眼睛会大。' },
  duo:   { label: '合照', lo: -3, hi:  8,
           over:  '手机架高了，两个人都会显矮。放到胸口高度。',
           under: '仰拍两个人容易显下巴，平一点。' },
};

const ROLL_TOLERANCE = 2.4;   // 歪超过这个度数就提醒，2° 以上肉眼能看出来
const TIP_HOLD_MS    = 900;   // 提示至少停留这么久，避免抖来抖去

export class Coach {
  constructor() {
    this.video    = $('#cam');
    this.overlay  = $('#overlay');
    this.octx     = this.overlay.getContext('2d');
    this.tilt     = new Tilt();
    this.reader   = new FrameReader();

    this.stream   = null;
    this.facing   = 'environment';
    this.running  = false;
    this.shotType = 'half';
    this.showGrid = store.prefs.grid !== false;
    this.head     = null;        // 用户点过的「她的头在这」
    this.stats    = null;
    this.reading  = null;

    this._raf = null;
    this._statTimer = null;
    this._tip = { key: null, since: 0, shown: null };

    this.overlay.style.pointerEvents = 'auto';
    this.overlay.addEventListener('click', (e) => this._markHead(e));
  }

  // ── 生命周期 ────────────────────────────────────────
  async start() {
    if (this.running) return true;

    if (!window.isSecureContext) {
      this._fail('这个页面必须用 HTTPS 打开，浏览器才允许访问摄像头。');
      return false;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this._fail('这个浏览器不支持网页调用摄像头。在 iPhone 上请用 Safari 打开。');
      return false;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: this.facing },
          width:  { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
    } catch (err) {
      this._fail(this._explain(err));
      return false;
    }

    this.video.srcObject = this.stream;
    try { await this.video.play(); } catch { /* iOS 偶尔要等一拍 */ }

    $('#camIdle').hidden = true;
    $('#camError').hidden = true;
    $('#hud').hidden = false;
    $('#camBar').hidden = false;
    $('#camStack').hidden = false;
    document.body.classList.add('cam-on');

    this.running = true;
    if (store.prefs.tilt !== false) this.tilt.start();

    this._loop();
    this._statTimer = setInterval(() => this._sample(), 220);
    return true;
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    clearInterval(this._statTimer);
    this.tilt.stop();
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.head = null;
    this._tip = { key: null, since: 0, shown: null };
    $('#camIdle').hidden = false;
    $('#hud').hidden = true;
    $('#camBar').hidden = true;
    $('#camStack').hidden = true;
    document.body.classList.remove('cam-on');
    this.octx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  async flip() {
    this.facing = this.facing === 'environment' ? 'user' : 'environment';
    const wasRunning = this.running;
    this.stop();
    if (wasRunning) {
      const ok = await this.start();
      if (ok && this.facing === 'user') {
        toast('前置画质比后置差不少，合照能用后置就用后置。', 3200);
      }
    }
  }

  async enableTilt() {
    const ok = await this.tilt.start();
    const prefs = store.prefs; prefs.tilt = ok; store.prefs = prefs;
    if (!ok) {
      toast(this.tilt.permission === 'denied'
        ? '你拒绝了动作权限，水平仪用不了。在「设置 → Safari → 动作与方向的访问」里可以打开。'
        : '这台设备读不到陀螺仪，水平仪用不了。', 4200);
    }
    return ok;
  }

  setShotType(type) {
    if (SHOT_TYPES[type]) this.shotType = type;
  }

  toggleGrid() {
    this.showGrid = !this.showGrid;
    const prefs = store.prefs; prefs.grid = this.showGrid; store.prefs = prefs;
    return this.showGrid;
  }

  // ── 采样与判断 ──────────────────────────────────────
  _sample() {
    if (!this.running) return;
    const stats = this.reader.read(this.video);
    if (stats) {
      this.stats = stats;
      this.reading = interpret(stats);
    }
    this._updateHud();
  }

  _updateHud() {
    const t = this.tilt.read();
    const r = this.reading;

    const setChip = (sel, value, level) => {
      const chip = $(sel);
      chip.querySelector('.chip-v').textContent = value;
      chip.className = 'chip' + (level ? ' is-' + level : '');
    };

    if (t && t.rollValid) {
      const a = Math.abs(t.roll);
      setChip('#chipLevel', `${t.roll > 0 ? '右低 ' : t.roll < 0 ? '左低 ' : ''}${a.toFixed(1)}°`,
              a <= ROLL_TOLERANCE ? 'good' : a <= 5 ? 'warn' : 'bad');
    } else {
      setChip('#chipLevel', t ? '—' : '未开', null);
    }

    if (t) {
      const p = Math.round(t.pitch);
      const spec = SHOT_TYPES[this.shotType];
      const inRange = p >= spec.lo && p <= spec.hi;
      setChip('#chipPitch', `${p > 1 ? '俯' : p < -1 ? '仰' : '平'}${Math.abs(p)}°`,
              inRange ? 'good' : Math.abs(p - (p > spec.hi ? spec.hi : spec.lo)) < 7 ? 'warn' : 'bad');
    } else {
      setChip('#chipPitch', '未开', null);
    }

    if (r) {
      setChip('#chipLight', `${r.light.label}·${r.exposure.label}`,
              r.exposure.level === 'bad' ? 'bad'
              : r.exposure.level === 'warn' || r.light.level === 'warn' ? 'warn' : 'good');
    }

    this._pickTip(t, r);
  }

  /** 按优先级挑一条，并加迟滞避免闪烁。 */
  _pickTip(t, r) {
    const spec = SHOT_TYPES[this.shotType];
    let tip = null;

    if (r && r.exposure.level === 'bad') {
      tip = { key: 'exp-bad', sev: 'bad', icon: '◐', text: r.exposure.tip };
    } else if (r && r.light.label === '逆光') {
      tip = { key: 'backlit', sev: 'warn', icon: '☀', text: r.light.tip };
    } else if (t && t.rollValid && Math.abs(t.roll) > ROLL_TOLERANCE) {
      const dir = t.roll > 0 ? '左' : '右';
      tip = { key: 'roll', sev: Math.abs(t.roll) > 5 ? 'bad' : 'warn', icon: '⊹',
              text: `歪了 ${Math.abs(t.roll).toFixed(1)}°，往${dir}边掰回来一点。` };
    } else if (t && t.pitch > spec.hi + 2) {
      tip = { key: 'pitch-over', sev: 'warn', icon: '↓', text: spec.over };
    } else if (t && t.pitch < spec.lo - 2) {
      tip = { key: 'pitch-under', sev: 'warn', icon: '↑', text: spec.under };
    } else if (this.head) {
      const h = this._headAdvice();
      if (h) tip = h;
    }

    if (!tip && r && r.exposure.level === 'warn') {
      tip = { key: 'exp-warn', sev: 'warn', icon: '◐', text: r.exposure.tip };
    }
    if (!tip && r && r.light.tip) {
      tip = { key: 'light-ok', sev: 'good', icon: '☀', text: r.light.tip };
    }
    if (!tip && r && r.notes.length) {
      tip = { key: 'note', sev: 'good', icon: '·', text: r.notes[0] };
    }
    if (!tip) {
      tip = { key: 'clear', sev: 'good', icon: '✓',
              text: this.head
                ? '构图、光、角度都过了。剩下的是表情——去「话术」抽一句说给她听。'
                : '光和角度都没问题。点一下画面里她头的位置，我再帮你看构图。' };
    }

    const now = performance.now();
    if (tip.key !== this._tip.key) {
      this._tip = { key: tip.key, since: now, shown: this._tip.shown };
    }
    const held = now - this._tip.since;
    const escalating = tip.sev === 'bad' && this._tip.shown?.sev !== 'bad';
    if (this._tip.shown && tip.key !== this._tip.shown.key && held < TIP_HOLD_MS && !escalating) {
      tip = this._tip.shown; // 还没稳住，先不换
    } else {
      this._tip.shown = tip;
    }

    const box = $('#coachTip');
    box.hidden = false;
    box.className = 'coach-tip sev-' + tip.sev;
    $('#coachTipIcon').textContent = tip.icon;
    $('#coachTipText').textContent = tip.text;
  }

  _headAdvice() {
    const { x, y } = this.head;
    if (y > 0.36) {
      return { key: 'headroom', sev: 'warn', icon: '↕',
               text: '头顶上面空太多了。手机往下压，或者你蹲下来一点——她会立刻变高。' };
    }
    if (y < 0.05) {
      return { key: 'headcrop', sev: 'warn', icon: '↕', text: '头快出画了，镜头抬一点。' };
    }
    const offCenter = Math.abs(x - 0.5);
    const nearThird = Math.min(Math.abs(x - 1 / 3), Math.abs(x - 2 / 3));
    if (offCenter < 0.07 && this.shotType !== 'close') {
      return { key: 'centered', sev: 'warn', icon: '⊞',
               text: '她正好在画面正中间。往左或往右挪到竖线上，同一张照片会好看很多。' };
    }
    if (nearThird < 0.06) {
      return { key: 'thirds', sev: 'good', icon: '✓', text: '构图站位对了。可以按了。' };
    }
    return null;
  }

  _markHead(e) {
    if (!this.running) return;
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
    if (this.head) this._drawHead(g, w, h);

    const t = this.tilt.read();
    if (t && t.rollValid) this._drawLevel(g, w, h, t.roll);
  }

  _drawGrid(g, w, h) {
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(255,255,255,.26)';
    g.beginPath();
    for (let i = 1; i < 3; i++) {
      g.moveTo((w * i) / 3, 0); g.lineTo((w * i) / 3, h);
      g.moveTo(0, (h * i) / 3); g.lineTo(w, (h * i) / 3);
    }
    g.stroke();

    // 三分交点，站位的四个甜点
    g.fillStyle = 'rgba(255,138,91,.85)';
    for (const px of [1 / 3, 2 / 3]) {
      for (const py of [1 / 3, 2 / 3]) {
        g.beginPath(); g.arc(w * px, h * py, 3, 0, Math.PI * 2); g.fill();
      }
    }

    // 头顶留白参考线
    g.strokeStyle = 'rgba(255,255,255,.16)';
    g.setLineDash([5, 6]);
    g.beginPath(); g.moveTo(0, h * 0.14); g.lineTo(w, h * 0.14); g.stroke();
    g.setLineDash([]);
  }

  _drawHead(g, w, h) {
    const x = this.head.x * w, y = this.head.y * h;
    g.strokeStyle = 'rgba(255,138,91,.95)';
    g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, 15, 0, Math.PI * 2); g.stroke();

    // 指向最近的那条三分竖线
    const target = Math.abs(this.head.x - 1 / 3) < Math.abs(this.head.x - 2 / 3) ? 1 / 3 : 2 / 3;
    if (Math.abs(this.head.x - target) > 0.05) {
      g.strokeStyle = 'rgba(255,138,91,.55)';
      g.setLineDash([4, 5]);
      g.beginPath(); g.moveTo(x, y); g.lineTo(w * target, y); g.stroke();
      g.setLineDash([]);
    }
  }

  _drawLevel(g, w, h, roll) {
    const cx = w / 2, cy = h / 2;
    const half = Math.min(w * 0.3, 130);
    const ok = Math.abs(roll) <= ROLL_TOLERANCE;
    const rad = (-roll * Math.PI) / 180;

    // 固定的水平参考
    g.strokeStyle = 'rgba(255,255,255,.34)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(cx - half, cy); g.lineTo(cx - half * 0.42, cy);
    g.moveTo(cx + half * 0.42, cy); g.lineTo(cx + half, cy);
    g.stroke();

    // 跟着机身转的那条，重合即为水平
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
        return '摄像头权限被拒了。在 Safari 地址栏左边的「ᴀA」→「网站设置」里把相机改成允许，然后重试。';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return '找不到可用的摄像头。';
      case 'NotReadableError':
        return '摄像头被别的 App 占着。把相机类的 App 关掉再试。';
      default:
        return '打不开摄像头：' + (err?.message || err?.name || '未知错误');
    }
  }

  _fail(msg) {
    $('#camIdle').hidden = true;
    $('#camError').hidden = false;
    $('#camErrorMsg').textContent = msg;
  }
}

export { SHOT_TYPES };
