// 实时指导的纯逻辑。数值是可调的拍摄启发式，不是审美评分。

export const SHOT_TYPES = {
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

export function targetFor(composition, shotType, x = 0.5) {
  if (composition === 'free') return null;
  if (composition === 'center' || shotType === 'close' || shotType === 'duo') return 0.5;
  return x <= 0.5 ? 1 / 3 : 2 / 3;
}

const advice = (key, text, reason, icon = '↔', sev = 'warn') =>
  ({ key, text, reason, icon, sev, voice: text });

export function assessScene({ reading, tilt, subjects = [], shotType = 'half',
                              targetX = null, tracking = 'idle', manual = false, mirror = false }) {
  const checks = { light: 'unknown', framing: 'unknown', angle: tilt?.rollValid && Number.isFinite(tilt.roll) && Number.isFinite(tilt.pitch) ? 'good' : 'unknown' };
  const result = tip => ({ tip, checks, eligible: !tip && !manual && subjects.length > 0 });
  if (!reading) return result(advice('waiting', '正在读取画面', '等相机画面更新后再判断。', '◌', 'good'));
  checks.light = reading.exposure.level === 'good' && reading.light.level !== 'warn' ? 'good' : 'warn';
  if (reading.exposure.level === 'bad') {
    return result(advice('exposure', reading.exposure.label === '太暗' ? '先移到更亮的位置' : '让主体避开直射强光',
      reading.exposure.label === '太暗' ? '当前光线不足，先靠近窗边或光源。' : '亮部细节正在丢失，换个光位再拍。', '☀', 'bad'));
  }
  if (!subjects.length || manual) {
    const text = tracking === 'loading' ? '正在启动人物识别'
      : tracking === 'failed' ? '人物识别未启动'
      : manual ? '手动构图参考' : tracking === 'ready' ? '让拍摄对象进入画面' : '开启人物识别';
    const reason = manual ? '标记不会自动跟随人物；可以拍摄，但不判断最佳时机。'
      : tracking === 'failed' ? '可重试「识别」，也可以直接拍摄。'
      : tracking === 'loading' ? '首次需下载模型，加载期间仍可按快门。'
      : '需要持续看到人物，才能判断构图和稳定状态。';
    return result(advice('subject-' + tracking + '-' + manual, text, reason, '◎', 'good'));
  }
  if (shotType === 'duo' && subjects.length < 2) {
    checks.framing = 'warn';
    return result(advice('duo-missing', '让两个人都进入画面', '当前只识别到一人，退后一点再看。', '⤢'));
  }
  if (checks.light !== 'good') {
    const backlit = reading.light.label === '逆光';
    return result(advice('light-' + reading.light.label + '-' + reading.exposure.label,
      backlit ? '让脸转向光源' : reading.light.label === '脸过曝' ? '往柔和的光里挪一点'
      : reading.exposure.label === '偏暗' ? '靠近光源一点' : '避开过亮的背景',
      backlit ? '脸比背景暗。先改变站位，让光照到脸上。' : '先改善光线，再微调构图。', '☀'));
  }
  for (const s of subjects.slice(0, shotType === 'duo' ? 2 : 1)) {
    if (s.crop) {
      checks.framing = 'warn';
      return result(advice('crop-' + s.crop.at, '退半步，给画面下沿留一点余地', s.crop.text, '⤢', 'bad'));
    }
    if (s.headTop < 0.015 && shotType !== 'close') {
      checks.framing = 'warn';
      return result(advice('head-cut', '镜头稍微朝上一点', '头顶贴近画面上沿，先给头顶留白。', '↑'));
    }
    if (s.head.x < 0.08 || s.head.x > 0.92) {
      checks.framing = 'warn';
      return result(advice('edge', '把人物带回画面里', '人物贴近边缘，先把头部完整收进来。', '↔'));
    }
    if (shotType === 'full' && !s.visible?.feet) {
      checks.framing = 'warn';
      return result(advice('feet-missing', '退后一点，把脚也拍进来', '全身模式需要看到脚部；当前还没有确认。', '⤢'));
    }
  }
  const spec = SHOT_TYPES[shotType] || SHOT_TYPES.half;
  if (tilt?.rollValid && Math.abs(tilt.roll) > 2.4) {
    checks.angle = 'warn';
    const dir = tilt.roll > 0 ? '左' : '右';
    return result(advice('roll-' + dir, '手机往' + dir + '转正一点',
      '当前倾斜约 ' + Math.abs(tilt.roll).toFixed(1) + '°，先把画面扶正。', tilt.roll > 0 ? '↶' : '↷'));
  }
  if (tilt && (tilt.pitch > spec.hi + 2 || tilt.pitch < spec.lo - 2)) {
    checks.angle = 'warn';
    const over = tilt.pitch > spec.hi + 2;
    return result(advice(over ? 'pitch-over' : 'pitch-under', over ? spec.overV : spec.underV,
      '这是' + spec.label + '模式的起始角度建议，可以按自己的风格调整。', over ? '↓' : '↑'));
  }
  const s = subjects[0];
  if (s.headTop > 0.28 && shotType !== 'full') {
    checks.framing = 'warn';
    return result(advice('headroom', '镜头稍微朝下一点', '头顶留白偏多，让人物在画面里更突出。', '↓'));
  }
  const height = s.box ? s.box.y1 - s.box.y0 : 0;
  if (height > 0 && height < (shotType === 'full' ? 0.58 : 0.42)) {
    checks.framing = 'warn';
    return result(advice('distance', '走近一点', '人物在画面里偏小，先缩短拍摄距离。', '⤡'));
  }
  const x = shotType === 'duo' ? (subjects[0].head.x + subjects[1].head.x) / 2 : s.head.x;
  if (targetX !== null && Math.abs(x - targetX) > 0.07) {
    checks.framing = 'warn';
    const dir = (x > targetX) !== mirror ? '右' : '左';
    return result(advice('compose-' + dir, '镜头往' + dir + '转一点',
      '让' + (shotType === 'duo' ? '两人的中点' : '人物') + '靠近虚线目标；居中和三分都是构图选择。', dir === '右' ? '→' : '←'));
  }
  checks.framing = 'good';
  return result(null);
}

// 持续稳定一段时间才推荐拍摄；中断、丢人、坏光线会立即撤销绿灯。
export class ReadinessGate {
  constructor(holdMs = 1100) { this.holdMs = holdMs; this.reset(); }
  reset() { this.since = null; this.lastAt = null; this.anchor = null; }
  update({ now, eligible, subjects = [] }) {
    const points = subjects.map(s => ({ x: s.head.x, y: s.head.y,
      height: s.box ? s.box.y1 - s.box.y0 : 0 })).sort((a, b) => a.x - b.x);
    if (!eligible || !points.length || points.some(p => !Number.isFinite(p.x + p.y + p.height))) {
      this.reset(); return { ready: false, progress: 0 };
    }
    const moved = !this.anchor || this.anchor.length !== points.length || points.some((p, i) =>
      Math.hypot(p.x - this.anchor[i].x, p.y - this.anchor[i].y) > 0.018 ||
      Math.abs(p.height - this.anchor[i].height) > 0.035);
    if (this.lastAt === null || now - this.lastAt > 600 || now < this.lastAt || moved) {
      this.since = now;
      this.anchor = points;
    }
    this.lastAt = now;
    const progress = Math.max(0, Math.min(1, (now - this.since) / this.holdMs));
    return { ready: progress >= 1, progress };
  }
}
