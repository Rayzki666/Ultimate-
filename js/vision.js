// 自动认人：MediaPipe PoseLandmarker，实时拿到 33 个身体关键点。
//
// 之前这一页要你点一下「她的头在这」。有了关键点就不用点了，而且能判断
// 一件光靠点是判断不出来的事：画面下沿是不是正好切在她的关节上。
//
// 模型是按需从 CDN 加载的（WASM 加模型约 17MB），加载失败就退回点一下的老路子。

const MP_VERSION = '1.0.1';

// 运行时文件放在仓库里同源提供，不走 CDN——MediaPipe 的官方模型挂在
// storage.googleapis.com 上，那个域名在中国大陆基本不可用。同源还顺带
// 让它能进 Service Worker 缓存，彻底离线可用。详见 vendor/README.md。
//
// 路径按本模块的位置解析，所以部署在 /用户名.github.io/仓库名/ 这种子路径下也对。
const LOCAL = {
  bundle: new URL('../vendor/mediapipe/vision_bundle.mjs', import.meta.url).href,
  wasm:   new URL('../vendor/mediapipe/wasm', import.meta.url).href,
  model:  new URL('../vendor/mediapipe/pose_landmarker_lite.task', import.meta.url).href,
};

// 回退：仓库里只放了 SIMD 版的 WASM。老设备不支持 WASM SIMD 时，
// MediaPipe 会去要 _nosimd 那一份，本地没有，就整套改从 CDN 取。
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const REMOTE = {
  bundle: `${CDN_BASE}/vision_bundle.mjs`,
  wasm:   `${CDN_BASE}/wasm`,
  model:  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/'
        + 'pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
};

/** WASM SIMD 支持检测。MediaPipe 内部用的是同一段探针字节码。 */
async function simdSupported() {
  try {
    await WebAssembly.instantiate(new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123,
      3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
    ]));
    return true;
  } catch {
    return false;
  }
}

// BlazePose 33 点里我们用得到的那些
export const LM = {
  nose: 0,
  eyeL: 2, eyeR: 5,
  earL: 7, earR: 8,
  mouthL: 9, mouthR: 10,
  shoulderL: 11, shoulderR: 12,
  elbowL: 13, elbowR: 14,
  wristL: 15, wristR: 16,
  hipL: 23, hipR: 24,
  kneeL: 25, kneeR: 26,
  ankleL: 27, ankleR: 28,
  footL: 31, footR: 32,
};

const SKELETON = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
];

export class SubjectTracker {
  constructor() {
    this.landmarker = null;
    this.state = 'idle';   // idle | loading | ready | failed
    this.error = '';
    this._lastTs = -1;
  }

  get ready() { return this.state === 'ready'; }

  async load(onProgress) {
    if (this.state === 'ready' || this.state === 'loading') return this.ready;
    this.state = 'loading';
    try {
      const src = (await simdSupported()) ? LOCAL : REMOTE;
      this.source = src === LOCAL ? 'local' : 'cdn';

      onProgress?.('正在加载识别模型（首次约 18MB，之后走缓存）');
      const { FilesetResolver, PoseLandmarker } = await import(src.bundle);
      const fileset = await FilesetResolver.forVisionTasks(src.wasm);

      onProgress?.('正在启动');
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: src.model, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numPoses: 2,               // 合照模式要看得见两个人
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      this.state = 'ready';
      return true;
    } catch (err) {
      this.state = 'failed';
      this.error = err?.message || String(err);
      return false;
    }
  }

  /** @returns {null | Array<Array<{x,y,z,visibility}>>} 每个人一组关键点 */
  detect(video, timestamp) {
    if (!this.ready || !video.videoWidth) return null;
    // detectForVideo 要求时间戳严格递增
    const ts = timestamp <= this._lastTs ? this._lastTs + 1 : timestamp;
    this._lastTs = ts;
    try {
      return this.landmarker.detectForVideo(video, ts)?.landmarks || null;
    } catch {
      return null;
    }
  }

  dispose() {
    try { this.landmarker?.close(); } catch { /* 忽略 */ }
    this.landmarker = null;
    this.state = 'idle';
    this._lastTs = -1;
  }
}

/**
 * MediaPipe 给的坐标是相对「整帧视频」的，而 <video> 用了 object-fit: cover，
 * 屏幕上看到的只是视频中间的一块。判断构图必须按用户真正看到的那一块来算，
 * 否则「她在画面正中间」这种话会是错的。
 *
 * @returns {(p:{x:number,y:number}) => {x:number,y:number}} 帧内归一化 → 屏幕内归一化
 */
export function coverMapper(video, boxW, boxH, mirror = false) {
  const vw = video.videoWidth || 1, vh = video.videoHeight || 1;
  const scale = Math.max(boxW / vw, boxH / vh);
  const w = vw * scale, h = vh * scale;
  const ox = (boxW - w) / 2, oy = (boxH - h) / 2;
  return (p) => {
    const x = (p.x * w + ox) / boxW;
    return { x: mirror ? 1 - x : x, y: (p.y * h + oy) / boxH };
  };
}

const vis = (p) => p && p.visibility > 0.5;
const inFrame = (p) => vis(p) && p.x > -0.02 && p.x < 1.02 && p.y > -0.02 && p.y < 1.02;

function midpoint(a, b) {
  if (vis(a) && vis(b)) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, visibility: 1 };
  return vis(a) ? a : vis(b) ? b : null;
}

// 画面边缘离关节多近就算「切在关节上」
const CROP_NEAR = 0.06;

/**
 * 把关键点翻译成拍照时用得上的事实。坐标全部是屏幕内归一化（0..1）。
 */
export function readSubject(pts) {
  const P = (i) => pts[i];
  const eyes  = midpoint(P(LM.eyeL), P(LM.eyeR));
  const ears  = midpoint(P(LM.earL), P(LM.earR));
  const head  = eyes || ears || (vis(P(LM.nose)) ? P(LM.nose) : null);
  if (!head) return null;

  const shoulders = midpoint(P(LM.shoulderL), P(LM.shoulderR));
  const hips      = midpoint(P(LM.hipL), P(LM.hipR));
  const mouth     = midpoint(P(LM.mouthL), P(LM.mouthR));

  // 头顶：从眼睛往上推一个「眼到嘴」的距离，够用来判断留白
  const eyeToMouth = mouth && eyes ? Math.abs(mouth.y - eyes.y) : 0.03;
  const headTop = head.y - eyeToMouth * 1.7;

  // 头颈尺度：比耳距稳，因为不受转头影响
  const headScale = shoulders ? Math.hypot(head.x - shoulders.x, head.y - shoulders.y) : eyeToMouth * 4;

  // 肩线倾斜（度）。正数表示画面右边那侧的肩膀更低。
  let shoulderTilt = null, shoulderSpan = null;
  const sL = P(LM.shoulderL), sR = P(LM.shoulderR);
  if (vis(sL) && vis(sR)) {
    shoulderTilt = Math.atan2(sR.y - sL.y, sR.x - sL.x) * 180 / Math.PI;
    if (shoulderTilt > 90) shoulderTilt -= 180;
    if (shoulderTilt < -90) shoulderTilt += 180;
    shoulderSpan = Math.hypot(sR.x - sL.x, sR.y - sL.y);
  }

  // 肩宽相对头颈尺度：正面直对镜头时肩最宽，转过去就窄
  const squareness = shoulderSpan && headScale ? shoulderSpan / headScale : null;

  // 包围盒（只算看得见的点）
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0, seen = 0;
  for (const p of pts) {
    if (!vis(p)) continue;
    seen++;
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const box = seen ? { x0, y0: Math.min(y0, headTop), x1, y1 } : null;

  // 脸部方框，拿去采样亮度判逆光
  const faceHalf = Math.max(eyeToMouth * 1.6, 0.02);
  const face = { x0: head.x - faceHalf, y0: head.y - faceHalf * 1.2, x1: head.x + faceHalf, y1: head.y + faceHalf * 1.4 };

  return {
    head, headTop, headScale, eyes, shoulders, hips,
    shoulderTilt, squareness, box, face,
    crop: readCrop(pts),
    visible: {
      ankles: inFrame(P(LM.ankleL)) || inFrame(P(LM.ankleR)),
      knees:  inFrame(P(LM.kneeL))  || inFrame(P(LM.kneeR)),
      hips:   inFrame(P(LM.hipL))   || inFrame(P(LM.hipR)),
      feet:   inFrame(P(LM.footL))  || inFrame(P(LM.footR)),
      wrists: inFrame(P(LM.wristL)) || inFrame(P(LM.wristR)),
    },
  };
}

/**
 * 画面下沿有没有正好切在关节上。
 * 切在大腿中段、腰、胸口都好看；切在膝盖、脚踝、手腕上就很难看——
 * 这是摄影里少数几条真正「非此即彼」的规则，而且肉眼在小屏幕上很难当场发现。
 */
function readCrop(pts) {
  const P = (i) => pts[i];
  const near = (a, b) => {
    for (const p of [P(a), P(b)]) {
      if (vis(p) && Math.abs(1 - p.y) < CROP_NEAR) return true;
    }
    return false;
  };
  const below = (a, b) => {
    const ps = [P(a), P(b)].filter(vis);
    return ps.length > 0 && ps.every(p => p.y > 1);
  };
  const above = (a, b) => {
    const ps = [P(a), P(b)].filter(vis);
    return ps.length > 0 && ps.some(p => p.y <= 1);
  };

  if (near(LM.ankleL, LM.ankleR)) return { at: 'ankle', text: '画面下沿正好切在脚踝上。要么把脚整个给进来，要么往上收到小腿肚以上。' };
  if (near(LM.kneeL, LM.kneeR))   return { at: 'knee',  text: '下沿正好切在膝盖上，这是最难看的一刀。往下让一点或者收到大腿中段。' };
  if (near(LM.wristL, LM.wristR)) return { at: 'wrist', text: '下沿切在手腕上，手会像断了。往下让一点把手给全。' };
  if (below(LM.footL, LM.footR) && above(LM.ankleL, LM.ankleR)) {
    return { at: 'foot', text: '脚尖被切掉了一点点。要么整只脚给进来，要么干脆收到膝盖以上。' };
  }
  return null;
}

/** 画骨架。不是为了炫技——看到它在跟着人走，你才信它真的认出人了。 */
export function drawSkeleton(g, pts, map, w, h, color = 'rgba(255,138,91,.8)') {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 2;
  for (const [a, b] of SKELETON) {
    const pa = pts[a], pb = pts[b];
    if (!vis(pa) || !vis(pb)) continue;
    const A = map(pa), B = map(pb);
    g.beginPath();
    g.moveTo(A.x * w, A.y * h);
    g.lineTo(B.x * w, B.y * h);
    g.stroke();
  }
  g.fillStyle = color;
  for (const i of [LM.nose, LM.shoulderL, LM.shoulderR, LM.hipL, LM.hipR,
                   LM.kneeL, LM.kneeR, LM.ankleL, LM.ankleR, LM.wristL, LM.wristR]) {
    const p = pts[i];
    if (!vis(p)) continue;
    const q = map(p);
    g.beginPath();
    g.arc(q.x * w, q.y * h, 3, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}
