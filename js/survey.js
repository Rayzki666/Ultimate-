// 她的说明书：问卷 → 一组具体的拍摄规则。
//
// 这一页是整个 App 的地基。前面所有建议都是通用的摄影常识，
// 只有这里的答案是她本人的。有了它，「我猜她喜欢什么」才变成「她说了她要什么」。

import { $, el, loadJSON, toast, buzz } from './ui.js';
import { store } from './store.js';

let schema = null;

// ── 从答案生成规则 ────────────────────────────────────
const WORRY_RULES = {
  face:  '半身和特写用 2x 或 3x，镜头略高于她的眼睛再往下拍。永远不要用 0.5x 拍她。',
  fat:   '让她身体转 45 度侧对镜头，手臂和腰之间留出缝隙。别蹲得太低往上拍全身。',
  legs:  '拍全身时把手机放低到腰以下，镜头保持水平不要往下俯。让她重心放后腿、前脚点地。',
  chin:  '镜头抬到比她眼睛高一点点。让她下巴往前伸再往下压。绝不从下往上拍脸。',
  stiff: '给动作，不要给表情。用连拍，在她说话和走动的时候按。',
  hair:  '开拍前提醒一句头发和衣服——这是她自己要求的，不是你在挑剔。',
  bg:    '按快门前扫一眼画面的四个角。挪半步就能避开的东西，一定挪。',
  eyes:  '找有光的地方，让她的脸朝向光。眼睛里有光斑，整张脸就有神。',
  nomakeup: '她没化妆的时候，先问一句再拍，或者只拍不露脸的那一类。',
};

const PREP_RULES = {
  tidy:    '开拍前提醒她整理一下头发和衣服。',
  tell:    '先告诉她要拍什么、站哪儿。别一声不吭就举起手机。',
  preview: '第一张拍完立刻给她看，她确认了你再继续拍。',
  nothing: '别做铺垫，直接拍。她不想被提醒正在拍照。',
};

const GAZE_RULES = {
  candid: '她要的是抓拍。少喊她看镜头，多在她做别的事情的时候按。',
  camera: '她要的是看着镜头的照片，别全部拍成抓拍。',
  mix:    '抓拍和看镜头的各拍一些。',
};

const PUBLIC_RULES = {
  yes:  '人多的地方用长焦远远地拍，或者只拍不露脸的。别在街上让她站定摆姿势。',
  some: '看场合。人多的时候收敛一点，安静的地方再正经拍。',
  no:   '',
};

const VOLUME_RULES = {
  few:  '少而精。别把一堆几乎一样的照片丢给她挑，那是把活儿推给她。',
  many: '多拍，用连拍，原图都留着让她自己翻。',
  depends: '',
};

const AFTER_RULES = {
  raw:      '拍完把原图直接发给她。',
  picked:   '拍完你先挑几张好的给她，别丢一整个相册过去。',
  together: '拍完一起挑。这是她想要的相处，不只是流程。',
  edited:   '修好了再给她。她要的是成品。',
};

const DUO_RULES = {
  tripod: '把手机架起来用定时拍——她想要的是正经的两个人的合照，不是随手自拍。',
  selfie: '随手自拍就行，但手举高一点、稍微俯下来拍。',
  noface: '她愿意拍不露脸的：牵手、影子、背影。这类照片不要嫌少拍。',
  family: '带孩子的三人照，她想要。找人帮拍或者架手机定时。',
  ask:    '她不介意找人帮拍——递手机之前先把取景构好。',
};

const FRAMING_LABELS = { full: '全身', half: '半身', close: '脸部特写', wide: '有环境的远景' };
const DEFAULT_SHOT   = { close: 'close', half: 'half', full: 'full', wide: 'full' };

/** @returns {{headline:string, rules:string[], her:string[], free:string}} */
export function buildSpecSheet(a) {
  if (!a) return null;
  const rules = [];
  const push = s => { if (s && !rules.includes(s)) rules.push(s); };

  (a.worry || []).forEach(w => push(WORRY_RULES[w]));
  push(GAZE_RULES[a.gaze]);
  (a.prep || []).forEach(p => push(PREP_RULES[p]));
  push(PUBLIC_RULES[a.public]);
  push(VOLUME_RULES[a.volume]);
  (a.duo || []).forEach(d => push(DUO_RULES[d]));
  push(AFTER_RULES[a.after]);

  const her = [];
  if (a.goal === 'look')  her.push('她首先要的是「我在照片里好看」。构图和角度优先于气氛。');
  if (a.goal === 'story') her.push('她首先要的是回忆感，人自然就行。别过度摆拍。');
  if (a.goal === 'both')  her.push('她两样都要，但好看排在前面。');

  const framing = (a.framing || []).map(f => FRAMING_LABELS[f]).filter(Boolean);
  if (framing.length) her.push('她最想要的画面：' + framing.join('、') + '。');

  const headline = a.goal === 'story'
    ? '她要的是有回忆感的照片'
    : '她要的是「我在里面好看」的照片';

  return { headline, rules, her, free: (a.free || '').trim() };
}

/** 说明书的纯文本版，喂给 AI 点评用。 */
export function specSheetText(answers) {
  const s = buildSpecSheet(answers);
  if (!s) return '';
  const parts = [s.headline, ...s.her, ...s.rules];
  if (s.free) parts.push('她本人补充的原话：' + s.free);
  return parts.join('\n- ');
}

/** 教练页默认该按哪种取景类型给俯仰角建议。 */
export function preferredShotType(answers) {
  const f = answers?.framing || [];
  for (const k of ['close', 'half', 'full', 'wide']) {
    if (f.includes(k)) return DEFAULT_SHOT[k];
  }
  return 'half';
}

// ── 页面 ──────────────────────────────────────────────
export async function mountHer(onSaved) {
  schema = await loadJSON('./data/survey.json');
  render(onSaved);
}

export function render(onSaved) {
  const stateEl = $('#herState');
  const surveyEl = $('#survey');
  const answers = store.survey;
  stateEl.replaceChildren();

  if (answers) {
    const sheet = buildSpecSheet(answers);
    const box = el('div', { class: 'spec-sheet' }, [
      el('h2', { text: sheet.headline }),
      sheet.her.length ? el('ul', {}, sheet.her.map(t => el('li', { text: t }))) : null,
      sheet.rules.length ? el('h2', { text: '所以，拍的时候' }) : null,
      sheet.rules.length ? el('ul', {}, sheet.rules.map(t => el('li', { text: t }))) : null,
      sheet.free ? el('h2', { text: '她自己写的' }) : null,
      sheet.free ? el('p', { text: sheet.free }) : null,
    ]);
    stateEl.append(box);
    stateEl.append(el('div', { class: 'row', style: 'margin-top:12px' }, [
      el('button', {
        class: 'btn', text: '重新填一次',
        onclick: () => { surveyEl.hidden = false; buildForm(onSaved); surveyEl.scrollIntoView({ behavior: 'smooth' }); },
      }),
    ]));
    surveyEl.hidden = true;
    return;
  }

  stateEl.append(
    el('p', { class: 'fine', text: schema?.intro || '' }),
    el('button', {
      class: 'btn btn-primary btn-lg', text: '开始填（三分钟）',
      onclick: () => { surveyEl.hidden = false; buildForm(onSaved); surveyEl.scrollIntoView({ behavior: 'smooth' }); },
    }),
  );
}

function buildForm(onSaved) {
  const surveyEl = $('#survey');
  const prev = store.survey || {};
  const draft = {};
  for (const q of schema.questions) {
    draft[q.id] = q.type === 'multi' ? [...(prev[q.id] || [])] : (prev[q.id] ?? (q.type === 'text' ? '' : null));
  }

  surveyEl.replaceChildren();

  schema.questions.forEach((q, idx) => {
    const card = el('div', { class: 'q' }, [
      el('div', { class: 'q-n', text: `第 ${idx + 1} 题 / 共 ${schema.questions.length} 题` }),
      el('div', { class: 'q-t', text: q.q }),
      q.hint ? el('p', { class: 'q-h', text: q.hint }) : null,
    ]);

    if (q.type === 'text') {
      const ta = el('textarea', { placeholder: '想写就写，不想写可以跳过' });
      ta.value = draft[q.id] || '';
      ta.addEventListener('input', () => { draft[q.id] = ta.value; });
      card.append(ta);
    } else {
      const opts = el('div', { class: 'opts' });
      q.options.forEach(o => {
        const input = el('input', {
          type: q.type === 'multi' ? 'checkbox' : 'radio',
          name: q.id, value: o.v,
        });
        const label = el('label', { class: 'opt' }, [input, el('span', { text: o.t })]);
        const isOn = q.type === 'multi' ? draft[q.id].includes(o.v) : draft[q.id] === o.v;
        input.checked = isOn;
        label.classList.toggle('checked', isOn);

        input.addEventListener('change', () => {
          if (q.type === 'multi') {
            const set = new Set(draft[q.id]);
            input.checked ? set.add(o.v) : set.delete(o.v);
            draft[q.id] = [...set];
            label.classList.toggle('checked', input.checked);
          } else {
            draft[q.id] = o.v;
            opts.querySelectorAll('.opt').forEach(l => l.classList.remove('checked'));
            label.classList.add('checked');
          }
          buzz(10);
        });
        opts.append(label);
      });
      card.append(opts);
    }
    surveyEl.append(card);
  });

  surveyEl.append(el('div', { class: 'row' }, [
    el('button', {
      class: 'btn btn-primary btn-lg', text: '生成说明书',
      onclick: () => {
        store.survey = draft;
        toast('说明书生成了。之后每一条建议都会按她的答案来。', 3200);
        buzz([20, 40, 20]);
        render(onSaved);
        onSaved?.(draft);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
    }),
    el('button', { class: 'btn btn-ghost', text: '先不填', onclick: () => { surveyEl.hidden = true; } }),
  ]));

  if (schema.outro) surveyEl.append(el('p', { class: 'fine', text: schema.outro }));
}
