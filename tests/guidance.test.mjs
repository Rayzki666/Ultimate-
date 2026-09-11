import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../js/guidance.js', import.meta.url), 'utf8');
const { assessScene, ReadinessGate, targetFor } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const frameSource = await readFile(new URL('../js/frame.js', import.meta.url), 'utf8');
const { coverRect, regionFromBox } = await import('data:text/javascript;base64,' + Buffer.from(frameSource).toString('base64'));
const subject = { head: { x: 1 / 3, y: .22 }, headTop: .16,
  box: { x0: .2, y0: .16, x1: .45, y1: .9 }, visible: { feet: true }, crop: null };
const reading = { exposure: { level: 'good', label: '正常' }, light: { level: 'good', label: '平光' }, notes: [] };
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
  assert.match(assessScene({ ...base, shotType: 'duo', subjects: [subject, { ...at(.67), crop: { at: 'knee', text: '膝盖在下沿' } }] }).tip.key, /^crop/);
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
  assert.equal(assessScene(scene).tip.key, 'compose-右');
  assert.equal(assessScene({ ...scene, mirror: true }).tip.key, 'compose-左');
});
test('bad exposure overrides composition and angle corrections', () => {
  const scene = { ...base, subjects: [at(.7)], tilt: { roll: 12, pitch: 5, rollValid: true },
    reading: { ...reading, exposure: { level: 'bad', label: '太暗' } } };
  assert.equal(assessScene(scene).tip.key, 'exposure');
});
test('unknown angles remain unknown and aesthetic notes do not block capture', () => {
  const result = assessScene({ ...base, tilt: null, reading: { ...reading, notes: ['环境光偏暖'] } });
  assert.equal(result.checks.angle, 'unknown');
  assert.equal(result.eligible, true);
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
