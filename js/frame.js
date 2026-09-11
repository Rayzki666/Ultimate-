// 帧分析：把取景画面缩到很小，用亮度分布判断曝光和光线方向。
// 全部在本机 canvas 上跑，画面不离开设备。

const W = 64, H = 64; // 缩到这么小就够判断光线了，而且不卡

export class FrameReader {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  /**
   * @param {HTMLVideoElement|HTMLImageElement|HTMLCanvasElement} source
   * @param {null|{sx:number,sy:number,sw:number,sh:number}} crop
   *   只分析源图里的这一块。取景时 <video> 是 object-fit: cover，
   *   屏幕上看到的只是视频中间一块——判断曝光要按看得见的那块算。
   * @returns {null | object} 亮度统计，画面还没准备好时返回 null
   */
  read(source, crop = null) {
    const sw = source.videoWidth || source.naturalWidth || source.width;
    const sh = source.videoHeight || source.naturalHeight || source.height;
    if (!sw || !sh) return null;

    try {
      if (crop) this.ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, W, H);
      else this.ctx.drawImage(source, 0, 0, W, H);
    } catch {
      return null; // 跨域画布被污染
    }

    let data;
    try {
      data = this.ctx.getImageData(0, 0, W, H).data;
    } catch {
      return null;
    }

    let sum = 0, clipHigh = 0, clipLow = 0;
    let sumR = 0, sumB = 0;
    let centerSum = 0, centerN = 0;
    let outerSum = 0, outerN = 0;
    let leftSum = 0, rightSum = 0;
    let topSum = 0, botSum = 0;

    // 中央 44% 见方当作「主体所在」，外圈当作「背景」
    const c0 = Math.round(W * 0.28), c1 = Math.round(W * 0.72);
    const r0 = Math.round(H * 0.22), r1 = Math.round(H * 0.78);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        sum += luma; sumR += r; sumB += b;
        if (luma > 248) clipHigh++;
        if (luma < 6) clipLow++;

        if (x >= c0 && x < c1 && y >= r0 && y < r1) { centerSum += luma; centerN++; }
        else { outerSum += luma; outerN++; }

        if (x < W / 2) leftSum += luma; else rightSum += luma;
        if (y < H / 3) topSum += luma; else if (y >= (H * 2) / 3) botSum += luma;
      }
    }

    const n = W * H;
    const mean   = sum / n;
    const center = centerSum / (centerN || 1);
    const outer  = outerSum / (outerN || 1);
    const left   = leftSum / (n / 2);
    const right  = rightSum / (n / 2);
    const top    = topSum / (n / 3);
    const bottom = botSum / (n / 3);

    return {
      mean,
      center,
      outer,
      left,
      right,
      top,
      bottom,
      clipHigh: clipHigh / n,
      clipLow: clipLow / n,
      warmth: (sumR - sumB) / n,   // 正数偏暖（钨丝灯、夕阳），负数偏冷（阴天、荧光）
      backlit: outer - center,     // 背景比主体亮多少
      sideBias: right - left,      // 正数表示光从右边来
    };
  }
  /**
   * 指定区域的平均亮度。知道脸在哪之后，用它和全画面比，
   * 判逆光比「中心对外圈」准得多——人不一定站在正中间。
   * @param {{sx:number,sy:number,sw:number,sh:number}} rect 源图像素坐标
   * @returns {number|null} 0..255
   */
  readRegion(source, rect) {
    const N = 16;
    if (!rect || rect.sw <= 0 || rect.sh <= 0) return null;
    if (!this._rc) {
      this._rc = document.createElement('canvas');
      this._rc.width = N; this._rc.height = N;
      this._rctx = this._rc.getContext('2d', { willReadFrequently: true });
    }
    let data;
    try {
      this._rctx.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, N, N);
      data = this._rctx.getImageData(0, 0, N, N).data;
    } catch {
      return null;
    }
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }
    return sum / (N * N);
  }
}

/** <video> 用 object-fit: cover 时，屏幕上实际显示的是源图里的哪一块。 */
export function coverRect(video, boxW, boxH) {
  const vw = video.videoWidth || 1, vh = video.videoHeight || 1;
  const scale = Math.max(boxW / vw, boxH / vh);
  const sw = boxW / scale, sh = boxH / scale;
  return { sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw, sh };
}

/** 屏幕内归一化的方框 → 源图像素方框，喂给 readRegion。 */
export function regionFromBox(box, crop, mirror = false) {
  if (mirror) box = { ...box, x0: 1 - box.x1, x1: 1 - box.x0 };
  const x0 = Math.max(0, Math.min(1, box.x0)), x1 = Math.max(0, Math.min(1, box.x1));
  const y0 = Math.max(0, Math.min(1, box.y0)), y1 = Math.max(0, Math.min(1, box.y1));
  if (x1 <= x0 || y1 <= y0) return null;
  return {
    sx: crop.sx + x0 * crop.sw,
    sy: crop.sy + y0 * crop.sh,
    sw: (x1 - x0) * crop.sw,
    sh: (y1 - y0) * crop.sh,
  };
}

/**
 * 把统计数字翻译成人话。
 * @returns {{exposure:object, light:object, notes:string[]}}
 */
export function interpret(stats, faceLuma = null) {
  const notes = [];

  // ── 曝光 ──
  let exposure;
  if (stats.mean < 42) {
    exposure = { level: 'bad', label: '太暗', tip: '光不够。找个有光的地方，或者让她靠近窗户、路灯、橱窗。', voice: '太暗了，去找光' };
  } else if (stats.clipHigh > 0.16) {
    exposure = { level: 'bad', label: '过曝', tip: '亮部已经死白了。点一下屏幕上她的脸对焦，然后手指往下滑降低曝光。', voice: '过曝了，往下滑降曝光' };
  } else if (stats.mean > 196) {
    exposure = { level: 'warn', label: '偏亮', tip: '整体偏亮，往下滑一点曝光会更耐看。', voice: '偏亮，降一点曝光' };
  } else if (stats.mean < 70) {
    exposure = { level: 'warn', label: '偏暗', tip: '有点暗。手机会自动提高感光度，画面会发糊有噪点——找点光。', voice: '有点暗，找点光' };
  } else {
    exposure = { level: 'good', label: '正常', tip: '' };
  }

  // ── 光位 ──
  // 认出人之后就用「她脸上的光」对比整个画面，比拿画面中心当主体准得多。
  const faceGap = faceLuma === null ? null : stats.mean - faceLuma;

  let light;
  if (faceGap !== null && faceGap > 34 && stats.mean > 108) {
    light = {
      level: 'warn', label: '逆光',
      tip: '她脸比背景暗一大截。点她的脸对焦测光——背景会过曝，但人是对的。',
      voice: '逆光，点她的脸测光',
    };
  } else if (faceGap !== null && faceGap < -46 && faceLuma > 224) {
    light = {
      level: 'warn', label: '脸过曝',
      tip: '光太直接了，她脸上已经死白。让她转开一点，或者挪到阴影边缘。',
      voice: '脸过曝了，往阴影里挪',
    };
  } else if (faceGap === null && stats.backlit > 42 && stats.outer > 118) {
    light = {
      level: 'warn', label: '逆光',
      tip: '逆光。要么点她的脸对焦测光（背景会过曝，但人是对的），要么就干脆拍剪影和发丝光。',
      voice: '逆光，点她的脸测光',
    };
  } else if (Math.abs(stats.sideBias) > 24) {
    const side = stats.sideBias > 0 ? '右' : '左';
    light = {
      level: 'good', label: `侧光·${side}`,
      tip: `光从${side}边来。让她的脸稍微转向${side}边一点，鼻子的影子会顺过来，脸会立体。`,
    };
  } else if (stats.mean > 150 && stats.clipHigh < 0.03 && Math.abs(stats.sideBias) < 12) {
    light = { level: 'good', label: '柔光', tip: '这是最好拍的光，随便拍都不难看。' };
  } else {
    light = { level: 'good', label: '平光', tip: '' };
  }

  // ── 附注 ──
  if (stats.top - stats.bottom > 78) {
    notes.push('天空比地面亮很多。要么少给天空，要么就让天空过曝、保住人脸。');
  }
  if (stats.warmth > 34) {
    notes.push('环境光偏暖（钨丝灯或夕阳），肤色会好看，别开白平衡自动纠偏。');
  }
  if (stats.clipLow > 0.34 && stats.mean < 90) {
    notes.push('大片死黑。暗部细节已经没了，靠后期救不回来。');
  }

  return { exposure, light, notes };
}

// ── 清晰度 ────────────────────────────────────────────
// 拉普拉斯方差：图像二阶导的方差。糊的照片没有高频细节，方差就低。
// 绝对值跟场景有关（纯色背景天然就低），所以主要用来在同一批照片里做相对比较——
// 一批照片里挑不出好的，多半就是因为大部分是糊的。

const SHARP_EDGE = 320;
let sharpCanvas = null;

export function sharpness(source, maxEdge = SHARP_EDGE) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  if (!sw || !sh) return null;

  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const w = Math.max(8, Math.round(sw * scale));
  const h = Math.max(8, Math.round(sh * scale));

  if (!sharpCanvas) sharpCanvas = document.createElement('canvas');
  sharpCanvas.width = w; sharpCanvas.height = h;
  const ctx = sharpCanvas.getContext('2d', { willReadFrequently: true });

  let data;
  try {
    ctx.drawImage(source, 0, 0, w, h);
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }

  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; p < gray.length; i += 4, p++) {
    gray[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }

  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const lap = gray[p - w] + gray[p + w] + gray[p - 1] + gray[p + 1] - 4 * gray[p];
      sum += lap; sumSq += lap * lap; n++;
    }
  }
  if (!n) return null;
  const mean = sum / n;
  return sumSq / n - mean * mean;   // 方差
}
