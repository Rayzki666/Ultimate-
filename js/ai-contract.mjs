// Shared strict contract. Model output is untrusted; unknown never means passed.
export const MAX_AGE_MS = 6500;
export function parseVerdict(value) {
  if (!value || !['shoot', 'adjust', 'uncertain'].includes(value.decision) ||
      !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1 ||
      typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 220 ||
      typeof value.action !== 'string' || value.action.length > 140 ||
      !['camera', 'subject', 'none'].includes(value.actor)) throw new Error('Invalid AI response');
  const checks = value.checks;
  for (const key of ['light', 'composition', 'background', 'pose', 'eyes'])
    if (!checks || !['good', 'adjust', 'unknown'].includes(checks[key])) throw new Error('Incomplete AI checks');
  const normalizedChecks = Object.fromEntries(['light', 'composition', 'background', 'pose', 'eyes'].map(k => [k, checks[k]]));
  if (value.decision === 'shoot' && (value.confidence < .8 || Object.values(checks).some(v => v !== 'good')))
    return { decision: 'uncertain', confidence: value.confidence, reason: 'AI could not confidently confirm this frame.',
      action: '', actor: 'none', checks: normalizedChecks };
  if (value.decision === 'adjust' && (!value.action.trim() || value.actor === 'none')) throw new Error('Incomplete AI adjustment');
  return { decision: value.decision, confidence: value.confidence, reason: value.reason.trim(),
    action: value.decision === 'adjust' ? value.action.trim() : '',
    actor: value.decision === 'adjust' ? value.actor : 'none', checks: normalizedChecks };
}
export function endpointURL(value) {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname))
    throw new Error('Use an HTTPS service origin, without a path or credentials.');
  return url.origin;
}
export function sceneChanged(a, b) {
  if (!a || !b || a.context !== b.context || a.people.length !== b.people.length ||
      !a.signature || !b.signature || a.signature.length !== b.signature.length) return true;
  if (a.people.some((p,i) => p.length !== b.people[i].length ||
      p.some((v,j) => !Number.isFinite(v) || !Number.isFinite(b.people[i][j]) || Math.abs(v - b.people[i][j]) > .035))) return true;
  const diff = a.signature.reduce((n,v,i) => n + Math.abs(v-b.signature[i]), 0) / a.signature.length;
  if (diff > 12) return true;
  if (!Array.isArray(a.faceSignature) || !Array.isArray(b.faceSignature) ||
      a.faceSignature.length !== b.faceSignature.length || !a.faceSignature.length) return true;
  const faceDiff = a.faceSignature.reduce((n,v,i) => n + Math.abs(v-b.faceSignature[i]), 0) / a.faceSignature.length;
  return faceDiff > .025;
}
export class MomentGate {
  constructor() { this.invalidate(); }
  invalidate() { this.request = null; this.result = null; this.since = null; this.last = null; }
  begin(id, at, scene) { this.invalidate(); this.request = { id, at, scene }; }
  observe(scene, now) {
    if (this.request && (now < this.request.at || now - this.request.at > MAX_AGE_MS || sceneChanged(this.request.scene, scene))) {
      this.invalidate(); return false;
    }
    return Boolean(this.request);
  }
  accept(id, raw, scene, now) {
    if (!this.observe(scene, now) || id !== this.request.id) return false;
    this.result = parseVerdict(raw); this.since = null; return true;
  }
  update({ scene, now, basicReady, instant }) {
    this.observe(scene, now);
    const ok = basicReady && instant === 'good' && this.result?.decision === 'shoot';
    if (!ok || this.last === null || now - this.last > 500 || now < this.last) this.since = null;
    this.last = now;
    if (ok && this.since === null) this.since = now;
    return { ready: Boolean(ok && now - this.since >= 500), result: this.result };
  }
}
