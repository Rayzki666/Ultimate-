// 路由与接线。

import { $, $$, el, toast, buzz } from './ui.js';
import { store } from './store.js';
import { Coach, SHOT_TYPES } from './coach.js';
import { mountRecipes, mountCues, mountDuo } from './content.js';
import { mountHer, render as renderHer, buildSpecSheet, preferredShotType } from './survey.js';
import { mountReview, addFiles } from './review.js';
import { verifyKey, hasKey } from './claude.js';

const coach = new Coach();
const mounted = new Set();

// ── 路由 ──────────────────────────────────────────────
const MOUNTERS = {
  recipes: mountRecipes,
  cues:    mountCues,
  duo:     mountDuo,
  review:  async () => mountReview(),
  her:     async () => mountHer(onSurveySaved),
};

async function go(name) {
  $$('.view').forEach(v => { v.hidden = v.dataset.view !== name; });
  $$('.tab').forEach(t => t.setAttribute('aria-current', String(t.dataset.go === name)));
  store.lastTab = name;

  // 离开取景页就把摄像头关掉，别让它在后台亮着
  if (name !== 'coach' && coach.running) coach.stop();

  if (!mounted.has(name) && MOUNTERS[name]) {
    mounted.add(name);
    try {
      await MOUNTERS[name]();
    } catch (err) {
      mounted.delete(name);
      toast('这一页没加载出来：' + err.message, 3500);
    }
  }
  window.scrollTo({ top: 0 });
}

$$('.tab').forEach(t => t.addEventListener('click', () => { buzz(10); go(t.dataset.go); }));

// ── 取景页 ────────────────────────────────────────────
$('#startCam').addEventListener('click', async () => {
  const ok = await coach.start();
  if (ok && store.prefs.tilt !== false) await coach.enableTilt();
});
$('#retryCam').addEventListener('click', () => {
  $('#camError').hidden = true;
  $('#camIdle').hidden = false;
});
$('#btnStop').addEventListener('click', () => coach.stop());
$('#btnFlip').addEventListener('click', () => coach.flip());
$('#btnGrid').addEventListener('click', (e) => {
  e.currentTarget.setAttribute('aria-pressed', String(coach.toggleGrid()));
});
$('#btnTilt').addEventListener('click', async (e) => {
  if (coach.tilt.active) {
    coach.tilt.stop();
    const p = store.prefs; p.tilt = false; store.prefs = p;
    e.currentTarget.setAttribute('aria-pressed', 'false');
  } else {
    const ok = await coach.enableTilt();
    e.currentTarget.setAttribute('aria-pressed', String(ok));
  }
});

$$('#shotTypes button').forEach(b => {
  b.addEventListener('click', () => {
    coach.setShotType(b.dataset.shot);
    $$('#shotTypes button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    buzz(10);
  });
});

// 用系统相机拍的原图，直接送到选片页
$('#nativeShot').addEventListener('change', (e) => {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (!files.length) return;
  go('review').then(() => addFiles(files));
});

// ── 合照倒计时 ────────────────────────────────────────
let timerSeconds = 10;
let timerHandle = null;
let audioCtx = null;

function beep(freq = 880, ms = 90) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.28, audioCtx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + ms / 1000);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + ms / 1000 + 0.02);
  } catch { /* 静音就静音 */ }
}

$$('[data-timer]').forEach(b => {
  b.addEventListener('click', () => {
    timerSeconds = Number(b.dataset.timer);
    $('#timerDisplay').textContent = String(timerSeconds);
  });
});

$('#timerStart').addEventListener('click', () => {
  if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
  let n = timerSeconds;
  const display = $('#timerDisplay');
  display.textContent = String(n);
  display.classList.add('hot');
  beep(660, 70);

  timerHandle = setInterval(() => {
    n -= 1;
    display.textContent = String(Math.max(n, 0));
    if (n > 0 && n <= 3) { beep(880, 80); buzz(40); }
    if (n <= 0) {
      clearInterval(timerHandle);
      timerHandle = null;
      beep(1320, 320);
      buzz([60, 60, 140]);
      display.textContent = '拍';
      setTimeout(() => {
        display.textContent = String(timerSeconds);
        display.classList.remove('hot');
      }, 1800);
    }
  }, 1000);
});

// ── 设置 ──────────────────────────────────────────────
function refreshKeyStatus() {
  $('#keyStatus').textContent = hasKey() ? '已保存，AI 点评可用。' : '没填，AI 点评关闭。';
}

$('#saveKey').addEventListener('click', async (e) => {
  const input = $('#apiKey');
  const key = input.value.trim();
  if (!key) { toast('先填一个 Key。'); return; }
  e.currentTarget.disabled = true;
  $('#keyStatus').textContent = '正在验证…';
  const res = await verifyKey(key);
  e.currentTarget.disabled = false;
  if (res.ok) {
    input.value = '';
    toast('Key 可用，AI 点评已经打开。', 3000);
  } else {
    toast(res.message, 4200);
  }
  refreshKeyStatus();
});

$('#clearKey').addEventListener('click', () => {
  store.apiKey = '';
  $('#apiKey').value = '';
  refreshKeyStatus();
  toast('已清除。');
});

$('#exportData').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'haohaopai-data.json' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

$('#wipeData').addEventListener('click', () => {
  if (!confirm('会清掉她的说明书、API Key 和所有设置。确定吗？')) return;
  store.wipe();
  renderHer(onSurveySaved);
  refreshKeyStatus();
  toast('清空了。');
});

// ── 说明书接到取景页 ──────────────────────────────────
function onSurveySaved(answers) {
  const type = preferredShotType(answers);
  coach.setShotType(type);
  $$('#shotTypes button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.shot === type)));
  renderCoachReminder();
}

function renderCoachReminder() {
  const host = $('#coachHelp');
  const old = host.querySelector('[data-her-reminder]');
  old?.remove();

  const sheet = buildSpecSheet(store.survey);
  if (!sheet || !sheet.rules.length) return;

  host.prepend(el('details', { 'data-her-reminder': true, open: true }, [
    el('summary', { text: '她说的（按你们填的问卷）' }),
    el('ul', { class: 'tight' }, sheet.rules.slice(0, 4).map(t => el('li', { text: t }))),
  ]));
}

// ── 启动 ──────────────────────────────────────────────
refreshKeyStatus();
renderCoachReminder();

const saved = store.survey;
if (saved) {
  const type = preferredShotType(saved);
  coach.setShotType(type);
  $$('#shotTypes button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.shot === type)));
}

// 说明书里的第一条常驻在取景页，所以「她」这一页一开始就要挂上
if (!mounted.has('her')) {
  mounted.add('her');
  mountHer(onSurveySaved).then(renderCoachReminder).catch(() => mounted.delete('her'));
}

const VIEWS = ['coach', 'recipes', 'cues', 'duo', 'review', 'her'];
go(VIEWS.includes(store.lastTab) ? store.lastTab : 'coach');

// 离开页面就释放摄像头
document.addEventListener('visibilitychange', () => {
  if (document.hidden && coach.running) coach.stop();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* 离线缓存失败不影响使用 */ });
  });
}

export { coach, SHOT_TYPES };
