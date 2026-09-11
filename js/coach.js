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
import { Voice, shorten } from './speak.js';
import { store } from './store.js';

const SHOT_TYPES = {
  full:  { label: '全身', lo: -4, hi:  5,
           over:  '手机放低到腰这么高。现在是俯拍，腿会显短一截。',
           overV: '手机放低一点',
           under: '仰得太狠了，身体会往后倒。',
           underV: '别仰这么多' },
  half:  { label: '半身', lo:  1, hi: 11,
           over:  '俯得有点多，会显头大身子小。收一点。',
           overV: '俯得太多了',
           under: '别从下往上拍——下巴和鼻孔会很明显。镜头抬到比她眼睛略高。',
           underV: '抬高一点，别仰拍' },
  close: { label: '特写', lo:  4, hi: 17,
           over:  '太俯了，额头会变大。',
           overV: '俯得太多了',
           under: '抬高一点，比她眼睛高一点点再往下拍，脸会小、眼睛会大。',
           underV: '抬到比她眼睛高一点' },
  duo:   { label: '合照', lo: -3, hi:  8,
           over:  '手机架高了，两个人都会显矮。放到胸口高度。',
           overV: '手机放低到胸口高度',
           under: '仰拍两个人容易显下巴，平一点。',
           underV: '平一点' },
};

const ROLL_TOLERANCE = 2.4;   // 歪超过这个度数就提醒，2° 以上肉眼能看出来
const TIP_HOLD_MS    = 900;   // 提示至少停留这么久，避免抖来抖去
const DETECT_HZ      = 12;    // 关键点检测频率。再高对判断没帮助，只费电

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
    // 前置画面镜像，跟人照镜子的直觉一致；分析时会把 x 一并翻回来
    this.video.style.transform = this.facing === 'user' ? 'scaleX(-1)' : '';
    try { await this.video.play(); } catch { /* iOS 偶尔要等一拍 */ }

    $('#camIdle').hidden = true;
    $('#camError').hidden = true;
    $('#hud').hidden = false;
    $('#camBar').hidden = false;
    $('#camStack').hidden = false;
    document.body.classList.add('cam-on');

    this.running = true;
    if (store.prefs.tilt !== false) this.tilt.start();
    if (store.prefs.voice !== false) this._setVoice(true);
    if (store.prefs.track) this.enableTracking();

    this._loop();
    this._statTimer = setInterval(() => this._sample(), 220);
    return true;
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    clearInterval(this._statTimer);
    this.tilt.stop();
    this.voice.stop();
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

  /** 自动认人。模型要从 CDN 下，所以是按需加载，失败就退回点一下的老路子。 */
  async enableTracking() {
    if (this.tracker.ready) return true;
    const ok = await this.tracker.load(msg => toast(msg, 2600));
    const prefs = store.prefs; prefs.track = ok; store.prefs = prefs;
    if (ok) {
      this.head = null;   // 认得出人了，手动标记就不需要了
      toast('认出人了。构图、留白、关节切割现在都自动看。', 3400);
    } else {
      toast('识别模型没加载成功（' + (this.tracker.error || '网络问题') + '）。点一下画面里她头的位置也一样能用。', 5000);
    }
    return ok;
  }

  disableTracking() {
    this.tracker.dispose();
    this.subjects = [];
    const prefs = store.prefs; prefs.track = false; store.prefs = prefs;
  }

  _setVoice(on) {
    const enabled = this.voice.toggle(on);
    const prefs = store.prefs; prefs.voice = enabled; store.prefs = prefs;
    if (enabled && !this.voice.supported) {
      toast('这个浏览器不支持语音播报。');
      return false;
    }
    return enabled;
  }

  toggleVoice() { return this._setVoice(!this.voice.enabled); }

  setShotType(type) {
    if (SHOT_TYPES[type]) this.shotType = type;
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
    const { w, h } = this._box;
    const crop = coverRect(this.video, w, h);

    const stats = this.reader.read(this.video, crop);
    if (stats) {
      // 认出人就用她脸上的光判逆光，比拿画面中心当主体准得多
      let faceLuma = null;
      const s0 = this.subjects[0];
      if (s0?.face) {
        const rect = regionFromBox(s0.face, crop);
        if (rect) faceLuma = this.reader.readRegion(this.video, rect);
      }
      this.stats = stats;
      this.reading = interpret(stats, faceLuma);
    }
    this._updateHud();
  }

  _detect(now) {
    if (!this.tracker.ready || now - this._lastDetect < 1000 / DETECT_HZ) return;
    this._lastDetect = now;

    const raw = this.tracker.detect(this.video, now);
    if (!raw) { this.subjects = []; return; }

    const { w, h } = this._box;
    const map = coverMapper(this.video, w, h, this.facing === 'user');
    this.subjects = raw
      .map(pts => {
        const mapped = pts.map(p => ({ ...map(p), z: p.z, visibility: p.visibility }));
        const s = readSubject(mapped);
        return s ? { ...s, pts: mapped } : null;
      })
      .filter(Boolean)
      .sort((a, b) => area(b.box) - area(a.box));
  }

  // ── 抬头显示 ────────────────────────────────────────
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

    const chipS = $('#chipSubject');
    if (this.tracker.ready) {
      const n = this.subjects.length;
      chipS.hidden = false;
      setChip('#chipSubject', n === 0 ? '没看到人' : n === 1 ? '认到 1 人' : `认到 ${n} 人`,
              n === 0 ? 'warn' : 'good');
    } else {
      chipS.hidden = true;
    }

    this._pickTip(t, r);
  }

  /** 按「有多毁照片」排序，只挑最靠前的那一条。 */
  _pickTip(t, r) {
    const spec = SHOT_TYPES[this.shotType];
    const subj = this.subjects[0];
    let tip = null;

    const T = (key, sev, icon, text, voice) => ({ key, sev, icon, text, voice: voice || shorten(text) });

    // 1. 曝光崩了——照片直接废
    if (r && r.exposure.level === 'bad') {
      tip = T('exp-bad', 'bad', '◐', r.exposure.tip, r.exposure.voice);
    }
    // 2. 脸上的光没了
    else if (r && (r.light.label === '逆光' || r.light.label === '脸过曝')) {
      tip = T('light-bad', 'warn', '☀', r.light.tip, r.light.voice);
    }
    // 3. 画面下沿切在关节上——构图硬伤，而且小屏幕上很难当场发现
    else if (subj?.crop) {
      tip = T('crop-' + subj.crop.at, 'bad', '✂',
              subj.crop.text,
              { ankle: '切在脚踝上了', knee: '切在膝盖上了',
                wrist: '切在手腕上了', foot: '脚尖切掉了' }[subj.crop.at]);
    }
    // 4. 机身歪
    else if (t && t.rollValid && Math.abs(t.roll) > ROLL_TOLERANCE) {
      const dir = t.roll > 0 ? '左' : '右';
      tip = T('roll', Math.abs(t.roll) > 5 ? 'bad' : 'warn', '⊹',
              `歪了 ${Math.abs(t.roll).toFixed(1)}°，往${dir}边掰回来一点。`,
              `往${dir}掰一点`);
    }
    // 5. 俯仰角
    else if (t && t.pitch > spec.hi + 2) {
      tip = T('pitch-over', 'warn', '↓', spec.over, spec.overV);
    } else if (t && t.pitch < spec.lo - 2) {
      tip = T('pitch-under', 'warn', '↑', spec.under, spec.underV);
    }
    // 6～9. 认出人之后才有的判断
    else if (subj) {
      tip = this._subjectTip(subj);
    }
    // 没开自动认人时的退路：手动标记
    else if (this.head) {
      tip = this._headTip();
    }

    if (!tip && r && r.exposure.level === 'warn') {
      tip = T('exp-warn', 'warn', '◐', r.exposure.tip, r.exposure.voice);
    }
    if (!tip && r && r.notes.length) {
      tip = T('note', 'good', '·', r.notes[0]);
    }

    // 什么都没挑出来 = 可以按了。
    // 但前提是我们确实知道她在哪儿——没认出人、也没点过位置的时候，
    // 「可以按了」是一句没有根据的话，不能说。
    const wasReady = this.ready;
    this.ready = !tip && (Boolean(subj) || Boolean(this.head));

    if (!tip) {
      tip = this.ready
        ? T('ready', 'ready', '●', '可以按了。', '可以按了')
        : this.tracker.ready
          ? T('nobody', 'good', '◌', '还没看到人。让她走进画面，或者退后一点。', '还没看到人')
          : T('clear', 'good', '✓',
              '光和角度都没问题。想让它自动看构图，点下面的「认人」。',
              '');
    }

    this._showTip(tip, wasReady);
  }

  _subjectTip(s) {
    const T = (key, sev, icon, text, voice) => ({ key, sev, icon, text, voice: voice || shorten(text) });
    const boxH = s.box ? s.box.y1 - s.box.y0 : 0;

    // 头顶
    if (s.headTop < 0.015 && this.shotType !== 'close') {
      return T('head-crop', 'warn', '↕', '头快出画了，镜头往上抬一点。', '镜头抬一点');
    }
    if (s.headTop > 0.28 && this.shotType !== 'full') {
      return T('headroom', 'warn', '↕',
               '头顶上面空太多了。手机往下压，或者你蹲下来一点——她会立刻变高。',
               '头顶空太多，手机往下压');
    }

    // 想拍全身却看不到脚
    if (this.shotType === 'full' && !s.visible.ankles && s.visible.hips) {
      return T('not-full', 'warn', '⤢',
               '这个框拍不到全身。退后两步，或者把手机放低到腰的高度再往回收。',
               '退后两步，拍不到全身');
    }
    // 太小 / 顶天立地
    if (boxH > 0 && boxH < 0.42) {
      return T('too-far', 'warn', '⤢',
               '她在画面里太小了。走近两步，或者变焦到 2x——别用 0.5x。',
               '太远了，走近点');
    }
    if (boxH > 0.985 && this.shotType !== 'close') {
      return T('too-tight', 'warn', '⤢', '顶天立地了，退半步给她留点余地。', '退半步');
    }
    if (this.shotType === 'close' && s.face && (s.face.x1 - s.face.x0) < 0.19) {
      return T('close-far', 'warn', '⤢',
               '特写要够近。退后两步，然后拉到 3x——退后变焦比走近拍好看。',
               '拉到三倍变焦');
    }

    // 站位
    const x = s.head.x;
    const offCenter = Math.abs(x - 0.5);
    const nearThird = Math.min(Math.abs(x - 1 / 3), Math.abs(x - 2 / 3));
    if (offCenter < 0.06 && this.shotType !== 'close' && this.shotType !== 'duo') {
      const dir = x <= 0.5 ? '左' : '右';
      return T('centered', 'warn', '⊞',
               `她正好在画面正中间。手机往${dir === '左' ? '右' : '左'}转一点，把她挪到竖线上。`,
               `她在正中间，挪到竖线上`);
    }
    if (x < 0.08 || x > 0.92) {
      return T('edge', 'warn', '⊞', '她快贴到画面边上了，往中间带一点。', '太靠边了');
    }

    // 合照：两个人之间的缝
    if (this.shotType === 'duo' && this.subjects.length >= 2) {
      const [a, b] = this.subjects;
      const gap = Math.abs(a.head.x - b.head.x);
      const scale = (a.headScale + b.headScale) / 2 || 0.1;
      if (gap > scale * 3.2) {
        return T('duo-gap', 'warn', '◐',
                 '你们俩中间有缝。靠近到肩膀挨着——有缝的合照看着像同事。',
                 '靠近一点，中间有缝');
      }
    }

    // 体态。这两条是建议不是纠错，所以放在最后。
    if (s.shoulderTilt !== null && Math.abs(s.shoulderTilt) > 9) {
      return T('shoulders', 'good', '⌐',
               '她一边肩膀明显高。提醒一句「肩膀往后、往下沉」就好。',
               '让她肩膀沉一下');
    }
    if (s.squareness !== null && s.squareness > 2.25 && this.shotType !== 'duo') {
      return T('square', 'good', '↻',
               '她正面直对着镜头，这是最显宽的角度。让她身体转 45 度，脸转回来。',
               '让她身体转四十五度');
    }
    if (nearThird < 0.06) return null;   // 站位已经对了，没什么可说的
    return null;
  }

  _headTip() {
    const { x, y } = this.head;
    const T = (key, sev, icon, text) => ({ key, sev, icon, text, voice: shorten(text) });
    if (y > 0.36) return T('headroom', 'warn', '↕', '头顶上面空太多了。手机往下压，或者你蹲下来一点——她会立刻变高。');
    if (y < 0.05) return T('headcrop', 'warn', '↕', '头快出画了，镜头抬一点。');
    if (Math.abs(x - 0.5) < 0.07 && this.shotType !== 'close') {
      return T('centered', 'warn', '⊞', '她正好在画面正中间。往左或往右挪到竖线上，同一张照片会好看很多。');
    }
    return null;
  }

  /** 迟滞：新提示要稳住一会儿才换，除非严重程度升级了。 */
  _showTip(tip, wasReady) {
    const now = performance.now();
    if (tip.key !== this._tip.key) {
      this._tip = { key: tip.key, since: now, shown: this._tip.shown };
    }
    const held = now - this._tip.since;
    const escalating = tip.sev === 'bad' && this._tip.shown?.sev !== 'bad';
    if (this._tip.shown && tip.key !== this._tip.shown.key && held < TIP_HOLD_MS && !escalating) {
      tip = this._tip.shown;
    } else {
      this._tip.shown = tip;
    }

    const box = $('#coachTip');
    box.hidden = false;
    box.className = 'coach-tip sev-' + tip.sev;
    $('#coachTipIcon').textContent = tip.icon;
    $('#coachTipText').textContent = tip.text;

    const stage = this.video.closest('.camera-stage');
    stage?.classList.toggle('is-ready', this.ready);
    if (this.ready && !wasReady) {
      buzz([25, 45, 25]);
      this.voice.say('可以按了', { force: true });
    } else if (!this.ready && tip.sev !== 'good' && tip.voice) {
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
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(255,255,255,.26)';
    g.beginPath();
    for (let i = 1; i < 3; i++) {
      g.moveTo((w * i) / 3, 0); g.lineTo((w * i) / 3, h);
      g.moveTo(0, (h * i) / 3); g.lineTo(w, (h * i) / 3);
    }
    g.stroke();

    g.fillStyle = 'rgba(255,138,91,.85)';
    for (const px of [1 / 3, 2 / 3]) {
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

    const target = Math.abs(hx - 1 / 3) < Math.abs(hx - 2 / 3) ? 1 / 3 : 2 / 3;
    if (Math.abs(hx - target) > 0.05) {
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

function area(b) {
  return b ? Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0) : 0;
}

export { SHOT_TYPES };
