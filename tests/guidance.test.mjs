import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../js/guidance.js', import.meta.url), 'utf8');
const { assessScene, assessPose, ReadinessGate, targetFor } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const frameSource = await readFile(new URL('../js/frame.js', import.meta.url), 'utf8');
const { coverRect, regionFromBox, interpret } = await import('data:text/javascript;base64,' + Buffer.from(frameSource).toString('base64'));
const posePoints = Array.from({ length: 33 }, () => ({ x: .33, y: .5, visibility: 0 }));
for (const [i,x,y] of [[0,.33,.22],[2,.31,.2],[5,.35,.2],[11,.26,.35],[12,.4,.35],[15,.27,.61],[16,.39,.61],[31,.28,.9],[32,.39,.9]])
  posePoints[i] = { x, y, visibility: .95 };
const subject = { pts: posePoints, head: { x: 1 / 3, y: .22 }, headTop: .16,
  box: { x0: .2, y0: .16, x1: .45, y1: .9 }, visible: { feet: true }, crop: null };
const reading = { exposure: { level: 'good', label: 'Balanced' }, light: { level: 'good', label: 'Flat' }, notes: [] };
const base = { reading, tilt: { roll: 0, pitch: 5, rollValid: true }, subjects: [subject],
  targetX: 1 / 3, shotType: 'half', tracking: 'ready' };
const at = x => ({ ...subject, head: { x, y: .22 } });
test('no green light without fresh frame, detected subject, or with manual marking', () => {
  assert.equal(assessScene(base).eligible, true);
  for (const patch of [{ reading: null }, { subjects: [] }, { manual: true }]) {
    assert.equal(assessScene({ ...base, ...patch }).eligible, false);
  }
});
test('model loading and failure explain degraded mode', () => {
  for (const tracking of ['loading', 'failed', 'idle']) {
    const result = assessScene({ ...base, tracking, subjects: [] });
    assert.equal(result.eligible, false);
    assert.ok(result.tip.reason);
    assert.equal(result.checks.framing, 'unknown');
  }
});
test('duo requires both people and checks either person for a cut joint', () => {
  assert.equal(assessScene({ ...base, shotType: 'duo' }).tip.key, 'duo-missing');
  assert.equal(assessScene({ ...base, shotType: 'duo', targetX: .5, subjects: [at(.33), at(.67)] }).eligible, true);
  assert.match(assessScene({ ...base, shotType: 'duo', subjects: [subject, { ...at(.67), crop: { at: 'knee', text: 'Knee at lower edge' } }] }).tip.key, /^crop/);
});
test('composition is a choice; center and free never require thirds', () => {
  assert.equal(targetFor('center', 'half'), .5);
  assert.equal(targetFor('free', 'half'), null);
  assert.equal(targetFor('thirds', 'close'), .5);
  assert.equal(assessScene({ ...base, targetX: .5, subjects: [at(.5)] }).eligible, true);
  assert.equal(assessScene({ ...base, targetX: null, subjects: [at(.6)] }).eligible, true);
});
test('horizontal correction reverses for the mirrored front camera', () => {
  const scene = { ...base, subjects: [at(.6)] };
  assert.equal(assessScene(scene).tip.key, 'compose-right');
  assert.equal(assessScene({ ...scene, mirror: true }).tip.key, 'compose-left');
});
test('bad exposure overrides composition and angle corrections', () => {
  const scene = { ...base, subjects: [at(.7)], tilt: { roll: 12, pitch: 5, rollValid: true },
    reading: { ...reading, exposure: { level: 'bad', label: 'Too dark' } } };
  assert.equal(assessScene(scene).tip.key, 'exposure');
});
test('unknown angles block full readiness while aesthetic notes alone do not', () => {
  const result = assessScene({ ...base, tilt: null, reading: { ...reading, notes: ['Warm tones'] } });
  assert.equal(result.checks.angle, 'unknown');
  assert.equal(result.eligible, false);
  assert.equal(result.tip.key, 'angle-unchecked');
  assert.equal(assessScene({ ...base, reading: { ...reading, notes: ['Warm tones'] } }).eligible, true);
});
test('full body requires visible feet', () => {
  assert.equal(assessScene({ ...base, shotType: 'full', subjects: [{ ...subject, visible: { feet: false } }] }).tip.key, 'feet-missing');
});
function stable(gate, start = 0, subjects = [subject]) {
  let state;
  for (let now = start; now <= start + 1100; now += 220) state = gate.update({ now, eligible: true, subjects });
  return state;
}
test('readiness needs sustained evidence and withdraws immediately', () => {
  const gate = new ReadinessGate();
  assert.equal(gate.update({ now: 0, eligible: true, subjects: [subject] }).ready, false);
  assert.equal(stable(gate).ready, true);
  assert.equal(gate.update({ now: 1320, eligible: false, subjects: [subject] }).ready, false);
  assert.equal(gate.update({ now: 1540, eligible: true, subjects: [subject] }).progress, 0);
});
test('movement, scale change, timestamp gap and lost subjects reset readiness', () => {
  for (const [now, subjects] of [[1320, [at(.4)]], [1320, [{ ...subject, box: { ...subject.box, y1: .98 } }]], [2500, [subject]], [1320, []]]) {
    const gate = new ReadinessGate();
    stable(gate);
    assert.equal(gate.update({ now, eligible: true, subjects }).ready, false);
  }
});
test('duo readiness tracks both people regardless of detector array order', () => {
  const gate = new ReadinessGate();
  const pair = [at(.3), at(.7)];
  stable(gate, 0, pair);
  assert.equal(gate.update({ now: 1320, eligible: true, subjects: [...pair].reverse() }).ready, true);
  assert.equal(gate.update({ now: 1540, eligible: true, subjects: [pair[0], at(.8)] }).ready, false);
});
test('slow cumulative drift and invalid coordinates never produce a green light', () => {
  const gate = new ReadinessGate();
  for (let now = 0; now <= 2200; now += 220) {
    assert.equal(gate.update({ now, eligible: true, subjects: [at(.33 + now / 10000)] }).ready, false);
  }
  assert.equal(gate.update({ now: 2500, eligible: true, subjects: [at(NaN)] }).ready, false);
});
test('face light measurement reverses screen mirror before sampling pixels', () => {
  const crop = { sx: 100, sy: 0, sw: 1000, sh: 800 };
  const box = { x0: .1, x1: .2, y0: .2, y1: .4 };
  assert.equal(regionFromBox(box, crop).sx, 200);
  assert.equal(regionFromBox(box, crop, true).sx, 900);
});
test('portrait capture uses the exact visible crop without upscaling', () => {
  const crop = coverRect({ videoWidth: 1920, videoHeight: 1080 }, 300, 400);
  assert.equal(crop.sw, 810);
  assert.equal(crop.sh, 1080);
  assert.equal(crop.sx, 555);
});

const stylesSource = await readFile(new URL('../js/styles.js', import.meta.url), 'utf8');
const { getStyle, styleHint, STYLES } = await import('data:text/javascript;base64,' + Buffer.from(stylesSource).toString('base64'));
test('travel and editorial give different advice for the same subject size', () => {
  const scene = { ...base, shotType: 'full', subjects: [{ ...subject, box: { ...subject.box, y1: .66 } }] };
  assert.equal(assessScene({ ...scene, style: getStyle('travel') }).eligible, true);
  assert.equal(assessScene({ ...scene, style: getStyle('editorial') }).tip.key, 'distance');
  assert.equal(assessScene({ ...base, shotType: 'full', style: getStyle('travel') }).tip.key, 'style-space');
});
test('golden backlight guidance preserves the intention while protecting the face', () => {
  const scene = { ...base, reading: { ...reading, light: { level: 'warn', label: 'Backlit' } } };
  assert.equal(assessScene({ ...scene, style: getStyle('golden') }).tip.key, 'golden-backlight');
  assert.match(assessScene({ ...scene, style: getStyle('cinematic') }).tip.key, /^light-/);
  assert.equal(assessScene({ ...scene, style: getStyle('golden') }).eligible, false);
});
test('style advice responds to measured environment without blocking for warmth', () => {
  const stats = { warmth: 0, sideBias: 0, top: 120, bottom: 120 };
  const warm = styleHint(getStyle('golden'), { ...stats, warmth: 30 }, reading);
  const cool = styleHint(getStyle('golden'), stats, reading);
  assert.notEqual(warm, cool);
  assert.match(cool, /not detected/);
  assert.notEqual(styleHint(getStyle('travel'), stats, reading), styleHint(getStyle('travel'), { ...stats, top: 230 }, reading));
  assert.equal(assessScene({ ...base, style: getStyle('golden') }).eligible, true);
});
test('presets never override missing subjects, clipped exposure or cut joints', () => {
  for (const style of STYLES) {
    assert.equal(assessScene({ ...base, style, subjects: [] }).eligible, false);
    assert.equal(assessScene({ ...base, style, reading: { ...reading, exposure: { level: 'bad', label: 'Too dark' } } }).tip.key, 'exposure');
    assert.match(assessScene({ ...base, style, subjects: [{ ...subject, crop: { at: 'wrist', text: 'Clipped wrist' } }] }).tip.key, /^crop-/);
  }
});
test('unknown saved style safely falls back and exposure labels match guidance', () => {
  assert.equal(getStyle('old-or-invalid'), null);
  const r = interpret({ mean: 30, clipHigh: 0, sideBias: 0, top: 30, bottom: 30, warmth: 0, clipLow: 0, outer: 30, backlit: 0 });
  assert.equal(r.exposure.label, 'Too dark');
  assert.equal(assessScene({ ...base, reading: r }).tip.text, 'Move into more light');
});

test('pose checks allow raised or hidden hands while requiring head and shoulders', () => {
  assert.equal(assessPose([subject]).state, 'good');
  assert.equal(assessPose([{ ...subject, pts: [] }]).state, 'unknown');
  const raised = posePoints.map(p => ({ ...p }));
  raised[15].y = .2;
  assert.equal(assessScene({ ...base, subjects: [{ ...subject, pts: raised }] }).eligible, true);
  const hidden = posePoints.map(p => ({ ...p }));
  hidden[11].visibility = .2;
  assert.equal(assessScene({ ...base, subjects: [{ ...subject, pts: hidden }] }).eligible, false);
});
test('full body checks both feet and close-up uses face landmarks', () => {
  const hidden = posePoints.map(p => ({ ...p })); hidden[32].visibility = .2;
  assert.equal(assessPose([{ ...subject, pts: hidden }], 'full').state, 'unknown');
  assert.equal(assessPose([{ ...subject, pts: posePoints.slice(0, 6) }], 'close').state, 'good');
});
test('invalid angle readings cannot turn the complete indicator green', () => {
  for (const tilt of [null, { roll: 0, pitch: NaN, rollValid: true }, { roll: NaN, pitch: 5, rollValid: true }, { roll: 0, pitch: 5, rollValid: false }])
    assert.equal(assessScene({ ...base, tilt }).eligible, false);
});
test('arm movement resets stability even when head and body size stay fixed', () => {
  const gate = new ReadinessGate(); stable(gate);
  const moved = posePoints.map(p => ({ ...p })); moved[15].x += .08;
  assert.equal(gate.update({ now: 1320, eligible: true, subjects: [{ ...subject, pts: moved }] }).ready, false);
});
