// Claude 视觉点评。可选功能——不填 Key 时选片页会退回本地清单。
//
// 浏览器直连 api.anthropic.com：Anthropic 的接口允许跨域，
// 但必须带上 anthropic-dangerous-direct-browser-access 这个头，
// 表示「我知道我把 Key 放在了浏览器里」。
//
// 这个取舍在这里是成立的：Key 是他自己的，设备是他自己的，页面是静态的，
// 没有服务器能替他保管 Key，也没有别人会用到这个页面上的 Key。
// 但这套做法不适合做成多人产品——那时候 Key 必须放在服务端。

import { store } from './store.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5';

const SYSTEM = `You are a thoughtful photography coach. Respond in English.
Evaluate light, framing, visible sharpness and the intended shooting style.
Give specific, practical actions grounded in the supplied photos. Do not invent unseen details.
Do not identify people or rate their bodies, attractiveness, age or clothing.
A style is an intention, not a rigid rule. Recognize successful photographs without inventing flaws.
Do not provide conversation scripts or things to say to the subject.`;

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    score:   { type: 'integer', description: 'A photography score from 0 to 100, based on the intended look.' },
    keep:    { type: 'boolean', description: 'Whether the photo is worth keeping.' },
    oneLine: { type: 'string',  description: 'A short conclusion in English.' },
    good:    { type: 'array', items: { type: 'string' }, description: 'One to three specific strengths in English.' },
    fix:     { type: 'array', items: { type: 'string' }, description: 'One to three practical adjustments in English.' },
  },
  required: ['score', 'keep', 'oneLine', 'good', 'fix'],
  additionalProperties: false,
};

const PICK_SCHEMA = {
  type: 'object',
  properties: {
    bestIndex: { type: 'integer', description: 'The suggested favorite, numbered from 1.' },
    why:       { type: 'string',  description: 'Explain the choice in English.' },
    ranking:   {
      type: 'array',
      description: 'Rank every supplied photo once, best first.',
      items: {
        type: 'object',
        properties: {
          index:   { type: 'integer' },
          verdict: { type: 'string', description: 'One sentence about this photo in English.' },
        },
        required: ['index', 'verdict'],
        additionalProperties: false,
      },
    },
  },
  required: ['bestIndex', 'why', 'ranking'],
  additionalProperties: false,
};

export function hasKey() {
  return Boolean(store.apiKey);
}

class ClaudeError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function call(body) {
  const key = store.apiKey;
  if (!key) throw new ClaudeError('Add an API key in Settings first.', 0);

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ClaudeError('Unable to connect. Check your connection and try again.', 0);
  }

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* 忽略 */ }
    throw new ClaudeError(explainStatus(res.status, detail), res.status);
  }

  const data = await res.json();
  if (data.stop_reason === 'refusal') {
    throw new ClaudeError('The model did not review this photo. Try another.', 0);
  }

  const text = (data.content || []).find(b => b.type === 'text')?.text;
  if (!text) throw new ClaudeError('The service returned an empty response.', 0);
  try {
    return JSON.parse(text);
  } catch {
    throw new ClaudeError('The service response could not be read.', 0);
  }
}

function explainStatus(status, detail) {
  switch (status) {
    case 401: return 'The API key is invalid or expired. Update it in Settings.';
    case 403: return 'This API key does not have access.';
    case 429: return 'Rate or usage limit reached. Try again later.';
    case 400: return 'Request rejected' + (detail ? ': ' + detail : '.');
    case 529:
    case 503: return 'The service is busy. Try again later.';
    default:  return `Service error (${status})` + (detail ? ': ' + detail : '.');
  }
}

function contextBlock({ scene, local }) {
  const lines = [];
  if (scene) lines.push('Intended shooting style: ' + scene);
  if (local) lines.push('On-device measurements (estimates, use the image as evidence): ' +
    JSON.stringify({ meanBrightness: local.mean, clippedHighlights: local.clipHigh, clippedShadows: local.clipLow }));
  return lines.join('\n\n');
}

/** 点评单张。 */
export async function reviewOne(image, context = {}) {
  const ctx = contextBlock(context);
  return call({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: VERDICT_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
        { type: 'text', text: (ctx ? ctx + '\n\n' : '') + 'Review this photo in English.' },
      ],
    }],
  });
}

/** 一批里挑最好的。图放在文字前面，模型看图效果更好。 */
export async function pickBest(images, context = {}) {
  const ctx = contextBlock(context);
  const content = [];
  images.forEach((img, i) => {
    content.push({ type: 'text', text: `Photo ${i + 1}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
  });
  content.push({
    type: 'text',
    text: (ctx ? ctx + '\n\n' : '') +
      `Compare these ${images.length} photos. Choose a favorite and rank every photo. ` +
      'Explain your choices in English, considering the intended photograph.',
  });

  return call({
    model: MODEL,
    max_tokens: 3000,
    system: SYSTEM,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: PICK_SCHEMA } },
    messages: [{ role: 'user', content }],
  });
}

/** 存 Key 之前先验一下，免得拍完照才发现填错了。 */
export async function verifyKey(key) {
  const prev = store.apiKey;
  store.apiKey = key;
  try {
    await call({
      model: MODEL,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Return JSON with ok set to true.' }],
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
        },
      },
    });
    return { ok: true };
  } catch (err) {
    store.apiKey = prev;
    return { ok: false, message: err.message };
  }
}
