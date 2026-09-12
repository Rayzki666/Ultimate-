// Pure guidance logic. Thresholds are adjustable shooting heuristics.
export const SHOT_TYPES = {
  full: { label: 'Full body', lo: -4, hi: 5, overV: 'Lower the camera a little', underV: 'Reduce the upward tilt' },
  half: { label: 'Portrait', lo: 1, hi: 11, overV: 'Reduce the downward tilt', underV: 'Raise the camera toward eye level' },
  close: { label: 'Close-up', lo: 4, hi: 17, overV: 'Reduce the downward tilt', underV: 'Raise the camera slightly' },
  duo: { label: 'Together', lo: -3, hi: 8, overV: 'Lower the camera toward chest level', underV: 'Keep the camera more level' },
};
export function targetFor(composition, shotType, x = .5) {
  if (composition === 'free') return null;
  if (composition === 'center' || shotType === 'close' || shotType === 'duo') return .5;
  return x <= .5 ? 1/3 : 2/3;
}
const advice = (key, text, reason, icon = '↔', sev = 'warn') =>
  ({ key, text, reason, icon, sev, voice: text });
export function assessScene({ reading, tilt, subjects = [], shotType = 'half',
  targetX = null, tracking = 'idle', manual = false, mirror = false, style = null }) {
  const checks = { light: 'unknown', framing: 'unknown',
    angle: tilt?.rollValid && Number.isFinite(tilt.roll) && Number.isFinite(tilt.pitch) ? 'good' : 'unknown' };
  const result = tip => ({ tip, checks, eligible: !tip && !manual && subjects.length > 0 });
  if (!reading) return result(advice('waiting', 'Reading the scene', 'Waiting for a fresh camera frame.', '◌', 'good'));
  checks.light = reading.exposure.level === 'good' && reading.light.level !== 'warn' ? 'good' : 'warn';
  if (reading.exposure.level === 'bad') {
    const dark = reading.exposure.label === 'Too dark';
    return result(advice('exposure', dark ? 'Move into more light' : 'Move away from harsh light',
      dark ? 'There is too little light. Try a window or a brighter spot.' : 'Bright detail is being lost. Try softer light.', '☀', 'bad'));
  }
  if (!subjects.length || manual) {
    const text = tracking === 'loading' ? 'Starting subject detection'
      : tracking === 'failed' ? 'Subject detection unavailable'
      : manual ? 'Manual framing reference' : tracking === 'ready' ? 'Bring your subject into view' : 'Turn on subject detection';
    const reason = manual ? 'Your marker does not track movement. You can shoot, but readiness is not measured.'
      : tracking === 'failed' ? 'Tap Detect to retry, or take a photo anytime.'
      : tracking === 'loading' ? 'The first model download takes a moment. You can still shoot.'
      : 'A visible subject is needed to check framing and stability.';
    return result(advice('subject-' + tracking + '-' + manual, text, reason, '◎', 'good'));
  }
  if (shotType === 'duo' && subjects.length < 2) {
    checks.framing = 'warn';
    return result(advice('duo-missing', 'Bring both people into view', 'Only one person is detected. Try stepping back.', '⤢'));
  }
  if (checks.light !== 'good') {
    const backlit = reading.light.label === 'Backlit';
    if (backlit && style?.lightMode === 'rim') return result(advice('golden-backlight',
      'Turn slightly toward the light',
      'Keep the glow behind you, but bring more light onto the face. The face is currently too dark.', '☀'));
    return result(advice('light-' + reading.light.label + '-' + reading.exposure.label,
      backlit ? 'Turn the face toward the light' : reading.light.label === 'Face clipped' ? 'Move into softer light'
      : reading.exposure.label === 'Dim' ? 'Move closer to the light' : 'Reduce the bright background',
      backlit ? 'The face is darker than the background. Change position to light the face.' : 'Improve the light before refining the composition.', '☀'));
  }
  for (const s of subjects.slice(0, shotType === 'duo' ? 2 : 1)) {
    if (s.crop) {
      checks.framing = 'warn';
      return result(advice('crop-' + s.crop.at, 'Step back and leave space below', s.crop.text, '⤢', 'bad'));
    }
    if (s.headTop < .015 && shotType !== 'close') {
      checks.framing = 'warn';
      return result(advice('head-cut', 'Aim slightly higher', 'Leave a little space above the head.', '↑'));
    }
    if (s.head.x < .08 || s.head.x > .92) {
      checks.framing = 'warn';
      return result(advice('edge', 'Bring the subject into the frame', 'The head is too close to the edge.', '↔'));
    }
    if (shotType === 'full' && !s.visible?.feet) {
      checks.framing = 'warn';
      return result(advice('feet-missing', 'Step back to include the feet', 'Full body framing needs visible feet.', '⤢'));
    }
  }
  const spec = SHOT_TYPES[shotType] || SHOT_TYPES.half;
  if (tilt?.rollValid && Math.abs(tilt.roll) > 2.4) {
    checks.angle = 'warn';
    const dir = tilt.roll > 0 ? 'left' : 'right';
    return result(advice('roll-' + dir, 'Rotate the phone ' + dir + ' a little',
      'The frame is tilted by about ' + Math.abs(tilt.roll).toFixed(1) + '°. Level it gently.', tilt.roll > 0 ? '↶' : '↷'));
  }
  if (tilt && (tilt.pitch > spec.hi + 2 || tilt.pitch < spec.lo - 2)) {
    checks.angle = 'warn';
    const over = tilt.pitch > spec.hi + 2;
    return result(advice(over ? 'pitch-over' : 'pitch-under', over ? spec.overV : spec.underV,
      'A starting angle for ' + spec.label.toLowerCase() + ' framing. Adapt it to your intention.', over ? '↓' : '↑'));
  }
  const s = subjects[0];
  if (s.headTop > (style?.id === 'travel' ? .4 : .28) && shotType !== 'full') {
    checks.framing = 'warn';
    return result(advice('headroom', 'Aim slightly lower', 'Reduce the empty space above the subject.', '↓'));
  }
  const limits = style?.scales?.[shotType] || [shotType === 'full' ? .58 : .42, 1];
  // Check every detected subject used for a two-person shot.
  for (const person of subjects.slice(0, shotType === 'duo' ? 2 : 1)) {
    const height = person.box ? person.box.y1 - person.box.y0 : 0;
    if (height > 0 && height < limits[0]) {
      checks.framing = 'warn';
      return result(advice('distance', 'Move a little closer',
        style ? style.name + ' calls for more presence in the frame.' : 'The subject is small in the frame.', '⤡'));
    }
    if (height > limits[1]) {
      checks.framing = 'warn';
      return result(advice('style-space', 'Step back to show more of the scene',
        style.name + ' needs more space around the subject.', '⤢'));
    }
  }
  const x = shotType === 'duo' ? (subjects[0].head.x + subjects[1].head.x) / 2 : s.head.x;
  if (targetX !== null && Math.abs(x - targetX) > .07) {
    checks.framing = 'warn';
    const dir = (x > targetX) !== mirror ? 'right' : 'left';
    return result(advice('compose-' + dir, 'Pan a little to the ' + dir,
      'Bring ' + (shotType === 'duo' ? 'the midpoint between you' : 'the subject') + ' toward the guide.', dir === 'right' ? '→' : '←'));
  }
  checks.framing = 'good';
  return result(null);
}
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
