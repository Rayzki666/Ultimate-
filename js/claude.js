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

const SYSTEM = `你是一个替朋友看照片的摄影师。他在给他太太拍照，他太太说这些年他一直拍不出她喜欢的照片。

你评价的是摄影，不是人。绝对不要评价照片里的人的长相、身材、年龄或穿着，也不要试图辨认照片里是谁。

你看的是这些东西：
- 光：方向、软硬、脸上有没有难看的阴影、有没有过曝或死黑
- 角度：镜头高度、俯仰，会不会显脸大、显腿短、显下巴
- 构图：人放在画面哪里、头顶留白、有没有切在关节上、地平线歪不歪
- 背景：干净还是乱，有没有该挪开的东西
- 清晰度：糊没糊，是手抖还是对焦跑了
- 情绪：表情自然还是僵，是抓拍还是摆拍，这张有没有故事

建议必须具体到能立刻照做。「构图可以更好」是废话；「往左挪半步把垃圾桶挪出画面」才是建议。
说人话，不要用摄影黑话。语气像一个懂行的朋友，不是老师。
如果这张照片其实已经很好，就直说很好，不要为了凑数硬找毛病。`;

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    score:   { type: 'integer', description: '0 到 100。这张作为「她会喜欢的照片」的综合分。' },
    keep:    { type: 'boolean', description: '这张值不值得留下来。' },
    oneLine: { type: 'string',  description: '一句话结论，不超过 30 个字。' },
    good:    { type: 'array', items: { type: 'string' }, description: '拍对了的地方，一到三条。' },
    fix:     { type: 'array', items: { type: 'string' }, description: '下次同样场景该怎么改，一到三条，每条都要是能立刻照做的动作。' },
    sayNext: { type: 'string', description: '下次拍这种场景，他可以对她说的一句话。' },
  },
  required: ['score', 'keep', 'oneLine', 'good', 'fix', 'sayNext'],
  additionalProperties: false,
};

const PICK_SCHEMA = {
  type: 'object',
  properties: {
    bestIndex: { type: 'integer', description: '最值得留的那张的编号，从 1 开始。' },
    why:       { type: 'string',  description: '为什么是这张。' },
    ranking:   {
      type: 'array',
      description: '按好到差排序的编号，每张都要出现一次。',
      items: {
        type: 'object',
        properties: {
          index:   { type: 'integer' },
          verdict: { type: 'string', description: '这一张的一句话评价。' },
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
  if (!key) throw new ClaudeError('还没填 API Key。', 0);

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
    throw new ClaudeError('连不上网络。检查一下网，再试一次。', 0);
  }

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* 忽略 */ }
    throw new ClaudeError(explainStatus(res.status, detail), res.status);
  }

  const data = await res.json();
  if (data.stop_reason === 'refusal') {
    throw new ClaudeError('模型没有处理这张照片。换一张试试。', 0);
  }

  const text = (data.content || []).find(b => b.type === 'text')?.text;
  if (!text) throw new ClaudeError('返回内容是空的。', 0);
  try {
    return JSON.parse(text);
  } catch {
    throw new ClaudeError('返回的内容读不出来。', 0);
  }
}

function explainStatus(status, detail) {
  switch (status) {
    case 401: return 'API Key 不对，或者已经失效了。到「她」这一页重新填一次。';
    case 403: return '这个 Key 没有调用权限。';
    case 429: return '请求太频繁，或者额度用完了。等一下再试。';
    case 400: return '请求被拒绝了' + (detail ? '：' + detail : '。');
    case 529:
    case 503: return '服务暂时忙不过来，过一会儿再试。';
    default:  return `出错了（${status}）` + (detail ? '：' + detail : '。');
  }
}

function contextBlock({ specSheet, scene, local }) {
  const lines = [];
  if (specSheet) {
    lines.push('她本人填过一份问卷，这是她要的东西：\n- ' + specSheet);
    lines.push('评价这张照片时，把她的这些偏好放在最前面——通用的摄影标准要给她的偏好让路。');
  }
  if (scene) lines.push('拍摄场景：' + scene);
  if (local) {
    lines.push(
      '这张照片在本机测出来的客观数据（供参考，你看到的画面才是准的）：\n' +
      `- 平均亮度 ${Math.round(local.mean)}/255\n` +
      `- 高光死白占比 ${(local.clipHigh * 100).toFixed(1)}%，暗部死黑占比 ${(local.clipLow * 100).toFixed(1)}%\n` +
      `- 背景比主体亮 ${Math.round(local.backlit)}（大于 40 通常是逆光）\n` +
      `- 清晰度指标 ${local.sharpText || '未测'}`
    );
  }
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
        { type: 'text', text: (ctx ? ctx + '\n\n' : '') + '看看这张。' },
      ],
    }],
  });
}

/** 一批里挑最好的。图放在文字前面，模型看图效果更好。 */
export async function pickBest(images, context = {}) {
  const ctx = contextBlock(context);
  const content = [];
  images.forEach((img, i) => {
    content.push({ type: 'text', text: `第 ${i + 1} 张：` });
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
  });
  content.push({
    type: 'text',
    text: (ctx ? ctx + '\n\n' : '') +
      `这 ${images.length} 张是同一组里拍的。挑出最值得留的那张，并把全部排个序。` +
      '判断标准是「她会不会喜欢这张」，不是技术上哪张最标准。',
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
      messages: [{ role: 'user', content: '回一个字：好' }],
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
