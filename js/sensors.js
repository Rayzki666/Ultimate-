// 陀螺仪：机身歪没歪（roll）、镜头朝上还是朝下（pitch）。
//
// 直接读 deviceorientation 的 beta/gamma 会在手机接近竖直时碰上万向节死锁——
// gamma 会在 0 和 90 之间跳。所以这里先把欧拉角还原成「重力在机身坐标系里的方向」，
// 这个向量是连续的，而且推导过程里 alpha 会被消掉，所以不需要指南针，
// 相对方向也够用。
//
//   R = Rz(α)·Rx(β)·Ry(γ)
//   g_device = Rᵀ · (0,0,-1) = ( sinγ·cosβ , -sinβ , -cosγ·cosβ )
//
// 机身坐标系：x 沿屏幕向右，y 沿屏幕向上，z 从屏幕指向人（后置镜头朝 -z）。

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const SMOOTH = 0.18; // 一阶低通，越小越稳越迟钝

export class Tilt {
  constructor() {
    this._generation = 0;
    this.lastAt = -Infinity;
    this.g = null;          // 平滑后的重力方向（单位向量）
    this.active = false;
    this.permission = 'unknown'; // unknown | granted | denied | unsupported
    this._onOrient = this._onOrient.bind(this);
  }

  static get needsPermission() {
    return typeof DeviceOrientationEvent !== 'undefined'
        && typeof DeviceOrientationEvent.requestPermission === 'function';
  }

  /** 必须在用户手势里调用（iOS 13+ 的要求）。*/
  async start() {
    if (this.active) return true;
    const generation = ++this._generation;
    if (typeof DeviceOrientationEvent === 'undefined') {
      this.permission = 'unsupported';
      return false;
    }
    if (Tilt.needsPermission && this.permission !== 'granted') {
      try {
        const res = await DeviceOrientationEvent.requestPermission();
        this.permission = res === 'granted' ? 'granted' : 'denied';
        if (res !== 'granted') return false;
      } catch {
        this.permission = 'denied';
        return false;
      }
    } else {
      this.permission = 'granted';
    }
    if (generation !== this._generation) return false;
    window.addEventListener('deviceorientation', this._onOrient, true);
    this.active = true;
    return true;
  }

  stop() {
    ++this._generation;
    window.removeEventListener('deviceorientation', this._onOrient, true);
    this.active = false;
    this.g = null;
  }

  _onOrient(e) {
    if (!Number.isFinite(e.beta) || !Number.isFinite(e.gamma)) return;
    this.lastAt = performance.now();
    const b = e.beta * RAD, c = e.gamma * RAD;
    const raw = {
      x: Math.sin(c) * Math.cos(b),
      y: -Math.sin(b),
      z: -Math.cos(c) * Math.cos(b),
    };
    if (!this.g) {
      this.g = raw;
    } else {
      this.g = {
        x: this.g.x + (raw.x - this.g.x) * SMOOTH,
        y: this.g.y + (raw.y - this.g.y) * SMOOTH,
        z: this.g.z + (raw.z - this.g.z) * SMOOTH,
      };
    }
    const n = Math.hypot(this.g.x, this.g.y, this.g.z) || 1;
    this.g = { x: this.g.x / n, y: this.g.y / n, z: this.g.z / n };
  }

  /**
   * @returns {null | {roll:number, pitch:number, portrait:boolean, rollValid:boolean}}
   *   roll      机身歪的角度，已归一到最近的 90°，所以竖着横着都是「0 为正」。
   *             正数表示画面右边偏低。
   *   pitch     镜头俯角。0 为水平指向前方，正数往下俯拍，负数往上仰拍。
   *   rollValid 镜头快指向正上或正下时，重力几乎垂直于屏幕平面，
   *             这时候「歪不歪」本身没有意义，别报数。
   */
  read() {
    if (!this.g || !this.active || performance.now() - this.lastAt > 1500) return null;
    const { x, y, z } = this.g;

    // 重力在屏幕平面内的投影，与「屏幕正下方」的夹角。
    const planar = Math.hypot(x, y);
    const raw = Math.atan2(x, -y) * DEG;

    // 归一到最近的 90° 倍数：竖持、横持、倒着拿，0 都表示水平。
    const roll = ((raw + 45) % 90 + 90) % 90 - 45;
    const portrait = Math.abs(((raw % 180) + 180) % 180 - 90) > 45;

    const pitch = Math.asin(Math.max(-1, Math.min(1, -z))) * DEG;
    return { roll, pitch, portrait, rollValid: planar > 0.26 };
  }
}
