import { $, el, toast, buzz } from './ui.js';
import { FrameReader, interpret, sharpness } from './frame.js';
import { loadImage, toBase64Jpeg, previewURL, dimensions } from './img.js';
import { hasKey, reviewOne, pickBest } from './claude.js';

let generation = 0;
let shots = [];
export function addFiles(files) { return handleFiles([...files]); }
export function mountReview() {
  // The label opens its input natively; no second programmatic click.
  $('#reviewInput').addEventListener('change', e => {
    if (e.target.files?.length) handleFiles([...e.target.files]);
    e.target.value = '';
  });
  const checklist = $('#localChecklist');
  checklist.hidden = false;
  checklist.replaceChildren(el('details', {}, [
    el('summary', { text: 'Before you choose a favorite' }),
    el('ul', { class: 'tight' }, [
      'Does the frame tell the story you wanted?',
      'Check the face and eyes for sharpness at full size.',
      'Look around the edges for clipped hands, feet or distractions.',
      'Light readings are estimates. Your intention makes the final call.',
    ].map(text => el('li', { text }))),
  ]));
}
async function handleFiles(files) {
  const images = files.filter(f => f.type.startsWith('image/')).slice(0, 20);
  if (!images.length) { toast('Choose an image first.'); return; }
  const token = ++generation, grid = $('#reviewGrid'), reader = new FrameReader();
  shots.forEach(s => s.source.close?.()); shots = [];
  grid.replaceChildren(el('p', { class: 'busy', text: 'Reading photos' }));
  const loaded = [];
  for (const file of images) {
    try {
      const source = await loadImage(file);
      if (token !== generation) { source.close?.(); loaded.forEach(s => s.source.close?.()); return; }
      const stats = reader.read(source);
      loaded.push({ file, source, stats, reading: stats ? interpret(stats) : null, sharp: sharpness(source) });
    } catch { /* Unsupported images are skipped. */ }
  }
  if (token !== generation) { loaded.forEach(s => s.source.close?.()); return; }
  if (!loaded.length) { grid.replaceChildren(el('p', { class: 'fine', text: 'These images could not be read.' })); return; }
  shots = loaded;
  const maxSharp = Math.max(0, ...shots.map(s => s.sharp || 0));
  grid.replaceChildren();
  if (shots.length > 1 && hasKey()) {
    const batch = shots.slice(0, 6);
    const button = el('button', { class: 'btn', text: 'Ask AI to compare ' + batch.length + ' photos' });
    const out = el('div', { class: 'verdict' });
    button.addEventListener('click', async () => {
      button.disabled = true;
      out.textContent = 'Reviewing your selected photos…';
      try {
        const result = await pickBest(batch.map(s => toBase64Jpeg(s.source, 1200)));
        out.replaceChildren(el('h4', { text: 'Suggested favorite: photo ' + result.bestIndex }), el('p', { text: result.why }),
          el('ul', {}, (result.ranking || []).map(r => el('li', { text: 'Photo ' + r.index + ': ' + r.verdict }))));
      } catch (error) { out.textContent = error.message; }
      finally { button.disabled = false; }
    });
    grid.append(button, out);
  }
  shots.forEach((shot, index) => {
    const { w, h } = dimensions(shot.source);
    const metrics = el('div', { class: 'shot-metrics' }, [
      el('span', { class: 'metric', text: 'Photo ' + (index + 1) }),
      el('span', { class: 'metric', text: w + ' × ' + h }),
      shot.file.shootingStyle ? el('span', { class: 'metric', text: shot.file.shootingStyle }) : null,
    ]);
    if (shot.reading) metrics.append(
      el('span', { class: 'metric', text: 'Exposure: ' + shot.reading.exposure.label }),
      el('span', { class: 'metric', text: 'Light: ' + shot.reading.light.label }));
    if (shots.length > 1 && maxSharp > 0) metrics.append(el('span', { class: 'metric',
      text: 'Detail: ' + Math.round(shot.sharp / maxSharp * 100) + '% of batch peak' }));
    const save = el('button', { class: 'btn btn-primary', text: 'Save photo' });
    save.addEventListener('click', () => {
      const url = URL.createObjectURL(shot.file);
      const link = el('a', { href: url, download: shot.file.name || 'frame.jpg' });
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    });
    const body = el('div', { class: 'shot-body' }, [metrics, save]);
    if (hasKey()) {
      const ask = el('button', { class: 'btn', text: 'Review with AI', style: 'margin-left:8px' });
      const output = el('div', { class: 'verdict' });
      ask.addEventListener('click', async () => {
        ask.disabled = true; output.textContent = 'Reviewing this photo…';
        try {
          const result = await reviewOne(toBase64Jpeg(shot.source, 1200), { scene: shot.file.shootingStyle, local: shot.stats });
          output.replaceChildren(el('h4', { text: result.keep ? 'A keeper' : 'Worth another try' }), el('p', { text: result.oneLine }),
            el('h4', { text: 'What works' }), el('ul', {}, (result.good || []).map(text => el('li', { text }))),
            el('h4', { text: 'Try next time' }), el('ul', {}, (result.fix || []).map(text => el('li', { text }))));
          buzz(20);
        } catch (error) { output.textContent = error.message; }
        finally { ask.disabled = false; }
      });
      body.append(ask, output);
    }
    grid.append(el('div', { class: 'shot' }, [
      el('img', { src: previewURL(shot.source), alt: 'Photo ' + (index + 1), loading: 'lazy' }), body,
    ]));
  });
}
