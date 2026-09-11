// 选片与复盘。
//
// 没有 API Key 时，这一页做的是本机能可靠做到的两件事：
// 量曝光和逆光，量清晰度并在一批里排序——一批照片挑不出好的，
// 多半就是因为大部分都糊了，而这件事眼睛在小屏幕上看不出来。
// 填了 Key 才多出 AI 点评。

import { $, el, toast, buzz } from './ui.js';
import { FrameReader, interpret, sharpness } from './frame.js';
import { loadImage, toBase64Jpeg, previewURL, dimensions } from './img.js';
import { hasKey, reviewOne, pickBest } from './claude.js';
import { specSheetText } from './survey.js';
import { store } from './store.js';

const MAX_BATCH_PICK = 6;   // 一次最多送几张去挑，再多请求会很大
const AI_EDGE = 1200;       // 送去点评的长边，够判断构图和光，又不浪费视觉 token

const SELF_CHECK = [
  '地平线是平的吗？歪 2 度肉眼就看得出来。',
  '有没有正好切在手腕、膝盖、脚踝上？切在关节上会很难看，往上或往下挪都行。',
  '头顶留白是不是太多了？多出来的那块天花板，等于把她压矮了。',
  '构图是否符合你想表达的重点？居中和三分都可以，关键是有意识地选择。',
  '背景四个角有没有该挪走的东西？垃圾桶、电线杆、半个路人。',
  '她眼睛里有没有光斑？有光斑的眼睛才有神。',
  '她的手有没有事做？垂着的手是照片僵硬最大的来源。',
  '抛开技术，这张有没有让你想起当时？没有的话，好看也留不住。',
];

const shots = [];   // { file, source, stats, reading, sharp, aiEl, b64 }

/** 别处（比如系统相机拍完）也能把文件直接丢进来。 */
export function addFiles(files) {
  return handleFiles([...files]);
}

export function mountReview() {
  const input = $('#reviewInput');
  $('#dropzone').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    if (input.files?.length) handleFiles([...input.files]);
    input.value = '';   // 同一批可以再选一次
  });
  renderChecklist();
}

function renderChecklist() {
  const box = $('#localChecklist');
  box.hidden = false;
  box.replaceChildren(
    el('div', { class: 'card open' }, [
      el('div', { class: 'card-head' }, [
        el('span', { class: 'card-title', text: '自己过一遍这八条' }),
        el('span', { class: 'card-tag', text: '不用联网' }),
      ]),
      el('p', { class: 'card-goal', text: '这八条覆盖了绝大多数「说不上哪里不对」的照片。' }),
      el('div', { class: 'card-body' }, [
        el('ul', { class: 'tight' }, SELF_CHECK.map(t => el('li', { text: t }))),
      ]),
    ]),
  );
}

async function handleFiles(files) {
  const grid = $('#reviewGrid');
  const reader = new FrameReader();
  const images = files.filter(f => f.type.startsWith('image/'));
  if (!images.length) { toast('没有选到图片。'); return; }

  if (images.length > 20) toast(`选了 ${images.length} 张，先处理前 20 张。`, 3000);
  const batch = images.slice(0, 20);

  // 新的一批，清掉上一批
  shots.length = 0;
  grid.replaceChildren(el('p', { class: 'busy', text: `正在读 ${batch.length} 张` }));

  const loaded = [];
  for (const file of batch) {
    try {
      const source = await loadImage(file);
      const stats = reader.read(source);
      loaded.push({
        file, source, stats,
        reading: stats ? interpret(stats) : null,
        sharp: sharpness(source),
      });
    } catch {
      /* 读不出来的跳过 */
    }
  }

  if (!loaded.length) { grid.replaceChildren(el('p', { class: 'fine', text: '这些图都读不出来。' })); return; }

  // 清晰度在一批里做相对比较才有意义
  const sharps = loaded.map(s => s.sharp).filter(v => typeof v === 'number');
  const maxSharp = sharps.length ? Math.max(...sharps) : 0;

  grid.replaceChildren();
  if (loaded.length > 1) grid.append(batchBar(loaded));

  loaded.forEach((shot, i) => {
    shot.index = i;
    shot.relSharp = maxSharp > 0 && typeof shot.sharp === 'number' ? shot.sharp / maxSharp : null;
    shots.push(shot);
    grid.append(shotCard(shot, loaded.length));
  });
}

function batchBar(loaded) {
  const bar = el('div', { class: 'row', style: 'padding:2px 0 6px' });
  const n = Math.min(loaded.length, MAX_BATCH_PICK);
  if (hasKey()) {
    const btn = el('button', {
      class: 'btn btn-primary',
      text: `让 AI 从前 ${n} 张里挑一张`,
    });
    const out = el('div', { class: 'verdict', style: 'width:100%' });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      out.replaceChildren(el('p', { class: 'busy', text: '正在看这几张' }));
      try {
        const imgs = loaded.slice(0, n).map(s => toBase64Jpeg(s.source, AI_EDGE));
        const res = await pickBest(imgs, { specSheet: specSheetText(store.survey) });
        out.replaceChildren(
          el('h4', { text: `最值得留的是第 ${res.bestIndex} 张` }),
          el('p', { text: res.why }),
          el('ul', {}, (res.ranking || []).map(r => el('li', { text: `第 ${r.index} 张 — ${r.verdict}` }))),
        );
        buzz(30);
      } catch (err) {
        out.replaceChildren(el('p', { class: 'fine', text: err.message }));
      } finally {
        btn.disabled = false;
      }
    });
    bar.append(btn, out);
  } else {
    bar.append(el('p', { class: 'fine', style: 'margin:0',
      text: `选了 ${loaded.length} 张。下面每张都标了清晰度和曝光——先把糊的删掉，剩下的用上面那八条过一遍。` }));
  }
  return bar;
}

function shotCard(shot, total) {
  const { w, h } = dimensions(shot.source);
  const metrics = el('div', { class: 'shot-metrics' });

  const chip = (text, level) => el('span', { class: 'metric' + (level ? ' is-' + level : ''), text });

  metrics.append(chip(`第 ${shot.index + 1} 张`));
  if (w && h) metrics.append(chip(`${w}×${h}`));

  if (shot.reading) {
    const { exposure, light } = shot.reading;
    metrics.append(chip('曝光·' + exposure.label, exposure.level));
    metrics.append(chip('光·' + light.label, light.level === 'warn' ? 'warn' : 'good'));
  }

  if (shot.relSharp !== null) {
    const pct = Math.round(shot.relSharp * 100);
    const level = pct >= 80 ? 'good' : pct >= 45 ? 'warn' : 'bad';
    metrics.append(chip(
      total > 1 ? `清晰度 ${pct}%（这批里）` : `清晰度 ${Math.round(shot.sharp)}`,
      level));
  }

  const body = el('div', { class: 'shot-body' }, [metrics]);
  const save = el('button', { class: 'btn', text: '保存照片', style: 'margin-bottom:12px' });
  save.addEventListener('click', () => {
    const url = URL.createObjectURL(shot.file);
    const a = el('a', { href: url, download: shot.file.name || 'haohaopai.jpg' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
  body.append(save);

  // 本机能给的结论
  const local = [];
  if (shot.reading?.exposure.tip) local.push(shot.reading.exposure.tip);
  if (shot.reading?.light.tip) local.push(shot.reading.light.tip);
  (shot.reading?.notes || []).forEach(n => local.push(n));
  if (total > 1 && shot.relSharp !== null && shot.relSharp < 0.45) {
    local.unshift('这张明显比同批的其他照片糊。多半是手抖或者对焦跑了——直接删。');
  }
  if (local.length) {
    body.append(el('div', { class: 'verdict' }, [
      el('h4', { text: '本机测到的' }),
      el('ul', {}, local.map(t => el('li', { text: t }))),
    ]));
  }

  const aiBox = el('div', { class: 'verdict' });
  body.append(aiBox);

  if (hasKey()) {
    const btn = el('button', { class: 'btn', style: 'margin-top:10px', text: '让 AI 看看这张' });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      aiBox.replaceChildren(el('p', { class: 'busy', text: '正在看' }));
      try {
        const img = toBase64Jpeg(shot.source, AI_EDGE);
        const v = await reviewOne(img, {
          specSheet: specSheetText(store.survey),
          local: shot.stats ? {
            ...shot.stats,
            sharpText: shot.relSharp !== null
              ? `这批里相对 ${Math.round(shot.relSharp * 100)}%` : '未测',
          } : null,
        });
        aiBox.replaceChildren(
          el('div', { class: 'row' }, [
            el('span', { class: 'score' }, [String(v.score), el('small', { text: ' / 100' })]),
            el('span', { class: 'metric ' + (v.keep ? 'is-good' : 'is-bad'), text: v.keep ? '值得留' : '可以删' }),
          ]),
          el('p', { text: v.oneLine }),
          v.good?.length ? el('h4', { text: '拍对了' }) : null,
          v.good?.length ? el('ul', {}, v.good.map(t => el('li', { text: t }))) : null,
          v.fix?.length ? el('h4', { text: '下次改这个' }) : null,
          v.fix?.length ? el('ul', {}, v.fix.map(t => el('li', { text: t }))) : null,
          v.sayNext ? el('h4', { text: '下次可以这么说' }) : null,
          v.sayNext ? el('p', {}, [el('span', { class: 'say', text: v.sayNext })]) : null,
        );
        buzz(24);
      } catch (err) {
        aiBox.replaceChildren(el('p', { class: 'fine', text: err.message }));
      } finally {
        btn.disabled = false;
      }
    });
    body.append(btn);
  }

  return el('div', { class: 'shot' }, [
    el('img', { src: previewURL(shot.source), alt: `第 ${shot.index + 1} 张`, loading: 'lazy' }),
    body,
  ]);
}
