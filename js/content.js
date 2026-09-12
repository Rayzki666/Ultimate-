import { $, el, buzz } from './ui.js';
import { STYLES } from './styles.js';

function openExample(style) {
  const dialog = $('#exampleDialog');
  $('#exampleTitle').textContent = style.name;
  $('#exampleImage').src = style.example;
  $('#exampleImage').alt = style.exampleAlt;
  $('#exampleDescription').textContent = style.poseNote;
  dialog.showModal();
}
export function renderStyles(selectedId, onSelect) {
  $('#closeExample').onclick = () => $('#exampleDialog').close();
  $('#exampleDialog').onclick = e => { if (e.target === e.currentTarget) {
    const r = e.currentTarget.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.currentTarget.close();
  }};
  $('#styleList').replaceChildren(...STYLES.map(style => {
    const selected = style.id === selectedId;
    const choose = el('button', { class: 'style-select', type: 'button', 'data-style': style.id, 'aria-pressed': String(selected) },
      [el('span', { text: selected ? 'Use again' : 'Use this look' }), el('span', { text: '↗', 'aria-hidden': 'true' })]);
    choose.addEventListener('click', () => { buzz(15); onSelect(style.id); });
    const preview = el('button', { class: 'example-open', type: 'button', 'data-example': style.id, 'aria-label': 'View ' + style.name + ' example' }, [
      el('img', { src: style.example, alt: style.exampleAlt, width: 1024, height: 683, decoding: 'async' }),
      el('span', { class: 'example-caption', text: 'AI EXAMPLE · Tap to view' }),
    ]);
    preview.addEventListener('click', () => openExample(style));
    return el('article', { class: 'style-card' + (selected ? ' selected' : '') }, [
      el('div', { class: 'style-art' }, [preview, selected ? el('span', { class: 'style-selected', text: 'SELECTED' }) : null]),
      el('div', { class: 'style-copy' }, [
        el('p', { class: 'eyebrow', text: style.mood }), el('h2', { text: style.name }),
        el('p', { text: style.description }), el('p', { class: 'style-setup', text: style.poseNote }),
        el('p', { class: 'style-setup', text: style.setup }), choose,
      ]),
    ]);
  }));
}
