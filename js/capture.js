// 只拍视频像素，不含参考线或界面。裁切与取景框一致，不放大插值。
import { coverRect } from './frame.js';

export function captureFrame(video, width, height, mirror = false) {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    return Promise.reject(new Error('画面还没准备好，请稍等再拍。'));
  }
  const crop = coverRect(video, width, height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(crop.sw));
  canvas.height = Math.max(1, Math.round(crop.sh));
  const g = canvas.getContext('2d');
  if (!g) return Promise.reject(new Error('当前浏览器暂时无法保存照片。'));
  if (mirror) { g.translate(canvas.width, 0); g.scale(-1, 1); }
  g.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob
      ? resolve({ blob, width: canvas.width, height: canvas.height })
      : reject(new Error('照片生成失败，请再试一次。')), 'image/jpeg', 0.95);
  });
}
