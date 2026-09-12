import { $, el, buzz } from './ui.js';
import { STYLES } from './styles.js';

// Local vector studies show composition without pretending to be edited photos.
function study(style, index) {
  const [bg, light, ink] = style.palette;
  const travel = style.id === 'travel', center = style.id === 'editorial';
  const x = center ? 160 : 112, y = travel ? 105 : 62, size = travel ? 16 : 30;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">' +
    '<rect width="320" height="200" fill="' + bg + '"/>' +
    '<circle cx="260" cy="34" r="105" fill="' + light + '" opacity=".6"/>' +
    (travel ? '<path d="M0 150L85 70 145 140 232 65 320 130V200H0" fill="' + ink + '" opacity=".7"/>' :
      '<path d="M32 0V200M288 0V200" stroke="' + light + '" stroke-width="28" opacity=".3"/>') +
    '<ellipse cx="' + x + '" cy="' + y + '" rx="' + size*.55 + '" ry="' + size*.68 + '" fill="' + ink + '"/>' +
    '<path d="M' + (x-size) + ' 200L' + (x-size*.8) + ' ' + (y+size) + 'Q' + x + ' ' + (y+size*.3) + ' ' + (x+size*.8) + ' ' + (y+size) + 'L' + (x+size) + ' 200Z" fill="' + ink + '"/>' +
    '<path d="M107 0V200M213 0V200M0 67H320M0 133H320" stroke="white" stroke-width=".5" opacity=".2"/>' +
    '<text x="18" y="25" font-family="sans-serif" font-size="10" letter-spacing="2" fill="white" opacity=".8">FRAME / 0' + (index+1) + '</text></svg>';
  return el('img', { src: 'data:image/svg+xml,' + encodeURIComponent(svg), alt: style.name + ' composition study', width: 320, height: 200 });
}
export function renderStyles(selectedId, onSelect) {
  $('#styleList').replaceChildren(...STYLES.map((style, i) => {
    const selected = style.id === selectedId;
    const button = el('button', { class: 'style-select', type: 'button', 'data-style': style.id, 'aria-pressed': String(selected) },
      [el('span', { text: selected ? 'Use again' : 'Use this look' }), el('span', { text: '↗', 'aria-hidden': 'true' })]);
    button.addEventListener('click', () => { buzz(15); onSelect(style.id); });
    return el('article', { class: 'style-card' + (selected ? ' selected' : '') }, [
      el('div', { class: 'style-art' }, [study(style, i), selected ? el('span', { class: 'style-selected', text: 'SELECTED' }) : null]),
      el('div', { class: 'style-copy' }, [
        el('p', { class: 'eyebrow', text: style.mood }), el('h2', { text: style.name }),
        el('p', { text: style.description }), el('p', { class: 'style-setup', text: style.setup }), button,
      ]),
    ]);
  }));
}
