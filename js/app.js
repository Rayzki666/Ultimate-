import { $, $$, el, toast, buzz } from './ui.js';
import { store } from './store.js';
import { Coach, SHOT_TYPES } from './coach.js';
import { renderStyles } from './content.js';
import { getStyle } from './styles.js';
import { mountReview, addFiles } from './review.js';
import { verifyKey, hasKey } from './claude.js';

const coach = new Coach();
const capturedPhotos = [];
let capturing = false;
const views = ['coach', 'styles', 'review', 'settings'];
let reviewMounted = false;
function go(name) {
  if (!views.includes(name)) name = 'coach';
  $$('.view').forEach(v => { v.hidden = v.dataset.view !== name; });
  $$('.tab').forEach(t => t.setAttribute('aria-current', String(t.dataset.go === name)));
  store.lastTab = name;
  if (name !== 'coach') coach.stop();
  if (name === 'styles') renderStyles(coach.style?.id, chooseStyle);
  if (name === 'review' && !reviewMounted) { mountReview(); reviewMounted = true; }
  window.scrollTo({ top: 0 });
  return Promise.resolve();
}
function syncStyle() {
  const name = coach.style?.name || 'Free shooting';
  $('#activeStyleName').textContent = name;
  $('#idleStyle').textContent = coach.style ? name + ' · Change look ↗' : 'Explore shooting styles →';
  $('#styleLiveNote').textContent = coach.style?.setup || 'Choose a style to shape your live guidance.';
  $$('#shotTypes button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.shot === coach.shotType)));
  $$('#compositionTypes button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.composition === coach.composition)));
}
function chooseStyle(id) {
  coach.setStyle(id);
  syncStyle();
  go('coach');
}
$$('.tab').forEach(t => t.addEventListener('click', () => { buzz(10); go(t.dataset.go); }));
$('#idleStyle').addEventListener('click', () => go('styles'));
$('#activeStyle').addEventListener('click', () => go('styles'));
$('#clearStyle').addEventListener('click', () => chooseStyle(null));

function syncCamButtons() {
  $('#btnGrid').setAttribute('aria-pressed', String(coach.showGrid));
  $('#btnTilt').setAttribute('aria-pressed', String(coach.tilt.active));
  $('#btnTrack').setAttribute('aria-pressed', String(coach.tracker.ready));
  $('#btnVoice').setAttribute('aria-pressed', String(coach.voice.enabled));
}

$('#startCam').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  coach.voice.unlock();
  // 两个权限调用都从点击事件直接发起，避免 await 后丢失 iOS 用户手势。
  const tiltPromise = store.prefs.tilt !== false ? coach.tilt.start() : Promise.resolve(false);
  try {
    const ok = await coach.start();
    await tiltPromise;
    if (!ok || !coach.running) coach.tilt.stop();
    syncCamButtons();
  } finally { btn.disabled = false; }
});
$('#retryCam').addEventListener('click', () => {
  $('#camError').hidden = true;
  $('#camIdle').hidden = false;
});
$('#btnStop').addEventListener('click', () => coach.stop());
$('#btnFlip').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try { await coach.flip(); syncCamButtons(); } finally { btn.disabled = false; }
});
$('#btnGrid').addEventListener('click', (e) => {
  e.currentTarget.setAttribute('aria-pressed', String(coach.toggleGrid()));
});
$('#btnTilt').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (coach.tilt.active) {
    coach.tilt.stop();
    const p = store.prefs; p.tilt = false; store.prefs = p;
    btn.setAttribute('aria-pressed', 'false');
  } else {
    const ok = await coach.enableTilt();
    btn.setAttribute('aria-pressed', String(ok));
  }
});

$('#btnTrack').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (coach.tracker.ready) {
    coach.disableTracking();
    btn.setAttribute('aria-pressed', 'false');
    toast('Detection off. Manual markers guide framing only.');
    return;
  }
  btn.disabled = true;
  const ok = await coach.enableTracking();
  btn.disabled = false;
  btn.setAttribute('aria-pressed', String(ok));
});

$('#btnVoice').addEventListener('click', (e) => {
  e.currentTarget.setAttribute('aria-pressed', String(coach.toggleVoice()));
});

$$('#shotTypes button').forEach(b => {
  b.addEventListener('click', () => {
    coach.setShotType(b.dataset.shot);
    $$('#shotTypes button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    buzz(10);
  });
});

// 构图是偏好，居中不等于拍错了。
$$('#compositionTypes button').forEach(b => {
  b.setAttribute('aria-pressed', String(b.dataset.composition === coach.composition));
  b.addEventListener('click', () => {
    coach.setComposition(b.dataset.composition);
    $$('#compositionTypes button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
});

// 本次会话最多保留 20 张，不悄悄丢弃旧照片。
$('#captureNow').addEventListener('click', async () => {
  if (capturing) return;
  if (capturedPhotos.length >= 20) { toast('This session has 20 photos. Save them before refreshing to start again.'); return; }
  capturing = true;
  try {
    const { blob, width, height } = await coach.capture();
    const filename = 'haohaopai-' + Date.now() + '.jpg';
    const file = new File([blob], filename, { type: blob.type });
    file.shootingStyle = coach.style?.name || null;
    capturedPhotos.push(file);
    $('#captureCount').textContent = String(capturedPhotos.length);
    $('#viewCaptures').disabled = false;
    $('#captureStatus').textContent = 'Captured ' + capturedPhotos.length + ' · ' + width + ' × ' + height;
    buzz(35);
    toast('Captured. Open This session to view and save.', 1800);
  } catch (err) {
    toast(err.message || 'Capture failed. Please try again.', 3200);
  } finally { capturing = false; }
});
$('#viewCaptures').addEventListener('click', async () => {
  if (!capturedPhotos.length) return;
  await go('review');
  addFiles(capturedPhotos);
});
$('#btnShutter').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#nativeShot').click(); }
});

// 用系统相机拍的原图，直接送到选片页
$('#nativeShot').addEventListener('change', (e) => {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (!files.length) return;
  go('review').then(() => addFiles(files));
});


function refreshKeyStatus() {
  $('#keyStatus').textContent = hasKey() ? 'Key saved. Optional AI review is available.' : 'No key saved. On-device guidance works without one.';
}
$('#saveKey').addEventListener('click', async (e) => {
  const btn = e.currentTarget, input = $('#apiKey'), key = input.value.trim();
  if (!key) { toast('Enter an API key first.'); return; }
  btn.disabled = true;
  $('#keyStatus').textContent = 'Checking key…';
  try {
    const result = await verifyKey(key);
    if (result.ok) { input.value = ''; toast('Key saved.'); }
    else toast(result.message, 4500);
  } finally { btn.disabled = false; refreshKeyStatus(); }
});
$('#clearKey').addEventListener('click', () => { store.apiKey = ''; $('#apiKey').value = ''; refreshKeyStatus(); toast('Key removed.'); });
$('#exportData').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: 'application/json' }));
  const a = el('a', { href: url, download: 'frame-preferences.json' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});
$('#wipeData').addEventListener('click', () => {
  if (!confirm('Reset saved preferences and remove the API key?')) return;
  store.wipe(); coach.setStyle(null); refreshKeyStatus(); syncStyle(); toast('Preferences reset.');
});
if (getStyle(store.prefs.styleId)) coach.setStyle(store.prefs.styleId);
syncStyle();
refreshKeyStatus();
// Migrate old content tabs to the new focused navigation.
const savedTab = store.lastTab;
go(savedTab === 'recipes' ? 'styles' : savedTab === 'her' ? 'settings' : savedTab);
window.addEventListener('pagehide', () => coach.stop());
document.addEventListener('visibilitychange', () => { if (document.hidden) coach.stop(); });
if ('serviceWorker' in navigator) window.addEventListener('load', () => {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
});
if (location.hash === '#debug') window.__coach = coach;
export { coach, SHOT_TYPES };
