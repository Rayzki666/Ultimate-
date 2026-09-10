// 图片读取、方向校正、缩小。
//
// 手机拍的 JPEG 带 EXIF 方向标记。createImageBitmap 的 imageOrientation:'from-image'
// 会把它转正；不支持的时候退回 <img>，现代浏览器默认也会应用 EXIF 方向。

export async function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* 退回 <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('图片读不出来'));
      img.src = url;
    });
    await img.decode?.().catch(() => {});
    return img;
  } finally {
    // 交给浏览器在下一帧之后回收，过早 revoke 会让部分 Safari 版本拿不到像素
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

export function dimensions(source) {
  return {
    w: source.width || source.naturalWidth || source.videoWidth || 0,
    h: source.height || source.naturalHeight || source.videoHeight || 0,
  };
}

/**
 * 缩到长边不超过 maxEdge，编成 JPEG。
 * 1400 是刻意选的：Claude 标准档的长边上限是 1568px，再大只是白花视觉 token。
 * @returns {{data:string, mediaType:string, w:number, h:number}}
 */
export function toBase64Jpeg(source, maxEdge = 1400, quality = 0.82) {
  const { w: sw, h: sh } = dimensions(source);
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, w, h);

  const url = canvas.toDataURL('image/jpeg', quality);
  return { data: url.slice(url.indexOf(',') + 1), mediaType: 'image/jpeg', w, h };
}

export function previewURL(source, maxEdge = 900) {
  const { w: sw, h: sh } = dimensions(source);
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}
