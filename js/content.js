// 渲染三个纯内容页：配方、话术、合照。

import { $, el, loadJSON, buzz } from './ui.js';

/** 配方和合照共用同一种卡片结构。 */
function specCard(item) {
  const body = el('div', { class: 'card-body' });
  const spec = el('div', { class: 'spec' });

  const block = (title, lines, cls) => {
    if (!lines || !lines.length) return null;
    return el('div', { class: 'spec-block' }, [
      el('h3', { text: title }),
      el('ul', { class: cls || '' }, lines.map(l => el('li', { text: l }))),
    ]);
  };

  const sayBlock = item.say?.length
    ? el('div', { class: 'spec-block' }, [
        el('h3', { text: '你说什么' }),
        el('ul', {}, item.say.map(l => el('li', {}, [el('span', { class: 'say', text: l })]))),
      ])
    : null;

  [
    block('相机怎么设', item.camera),
    block('她做什么', item.her),
    sayBlock,
    block('别踩这些坑', item.gotcha, 'gotcha'),
  ].forEach(b => b && spec.append(b));

  body.append(spec);

  const card = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('span', { class: 'card-title', text: item.title }),
      item.tag ? el('span', { class: 'card-tag', text: item.tag }) : null,
    ]),
    item.goal ? el('p', { class: 'card-goal', text: item.goal }) : null,
    body,
  ]);

  card.querySelector('.card-head').addEventListener('click', () => {
    card.classList.toggle('open');
    buzz(12);
  });
  return card;
}

// ── 配方 ──────────────────────────────────────────────
export async function mountRecipes() {
  const data = await loadJSON('./data/recipes.json');
  const listEl = $('#recipeList');
  const filterEl = $('#recipeFilter');
  let active = 'all';

  const render = () => {
    listEl.replaceChildren();
    const items = active === 'all'
      ? data.items
      : data.items.filter(i => i.filter?.includes(active));
    if (!items.length) {
      listEl.append(el('p', { class: 'fine', text: '这一类下面还没有卡片。' }));
      return;
    }
    items.forEach(i => listEl.append(specCard(i)));
  };

  data.filters.forEach(f => {
    const b = el('button', { type: 'button', text: f.label });
    b.setAttribute('aria-pressed', String(f.id === active));
    b.addEventListener('click', () => {
      active = f.id;
      filterEl.querySelectorAll('button').forEach(x =>
        x.setAttribute('aria-pressed', String(x === b)));
      render();
    });
    filterEl.append(b);
  });

  render();
}

// ── 话术 ──────────────────────────────────────────────
export async function mountCues() {
  const data = await loadJSON('./data/cues.json');
  const listEl = $('#cueList');
  const all = data.groups.flatMap(g => g.lines);

  data.groups.forEach(g => {
    const card = el('div', { class: 'card open' }, [
      el('div', { class: 'card-head' }, [el('span', { class: 'card-title', text: g.title })]),
      g.note ? el('p', { class: 'card-goal', text: g.note }) : null,
      el('div', { class: 'card-body' },
        g.lines.map(l => el('div', { class: 'cue-line' }, [
          el('span', { class: 'say', text: l.t }),
          l.w ? el('em', { text: l.w }) : null,
        ]))),
    ]);
    card.querySelector('.card-head').addEventListener('click', () => card.classList.toggle('open'));
    listEl.append(card);
  });

  let last = -1;
  $('#cueRandom').addEventListener('click', () => {
    let i = last;
    while (all.length > 1 && i === last) i = Math.floor(Math.random() * all.length);
    last = i;
    const line = all[i];
    const box = $('#cueDrawn');
    box.hidden = false;
    box.replaceChildren(
      el('span', { class: 'say', text: line.t }),
      line.w ? el('small', { text: line.w }) : null,
    );
    buzz(20);
  });
}

// ── 合照 ──────────────────────────────────────────────
export async function mountDuo() {
  const data = await loadJSON('./data/duo.json');
  const listEl = $('#duoList');
  if (data.intro) {
    listEl.append(el('p', { class: 'fine', text: data.intro }));
  }
  data.items.forEach(i => listEl.append(specCard(i)));
}
