// 语音播报。
//
// 这是「实时指导」里最要紧的一环：拍照的时候你的眼睛应该在她身上，不是在手机屏幕上。
// 提示念出来，你才可能一边看着她一边调整。
//
// 两条自律：只念真正要改的（good 级别不念，除非是「可以按了」），
// 而且两句之间留足间隔——一个不停说话的手机比不说话更糟。

const MIN_GAP_MS = 3400;

export class Voice {
  constructor() {
    this.enabled = false;
    this.supported = typeof speechSynthesis !== 'undefined'
                  && typeof SpeechSynthesisUtterance !== 'undefined';
    this._lastAt = 0;
    this._lastText = '';
    this._voice = null;
    this._unlocked = false;
  }

  /** iOS 要求先在用户手势里说过一次，之后才允许程序触发。*/
  unlock() {
    if (!this.supported || this._unlocked) return;
    try {
      const u = new SpeechSynthesisUtterance('');
      u.volume = 0;
      speechSynthesis.speak(u);
      this._unlocked = true;
    } catch { /* 不支持就算了 */ }
  }

  _pickVoice() {
    if (this._voice) return this._voice;
    try {
      const all = speechSynthesis.getVoices() || [];
      this._voice = all.find(v => v.lang === 'en-US')
                 || all.find(v => v.lang?.toLowerCase().startsWith('en'))
                 || null;
    } catch { /* 忽略 */ }
    return this._voice;
  }

  /**
   * @param {string} text 要念的话
   * @param {{force?:boolean}} opts force 表示无视间隔立刻念（用于「可以按了」）
   */
  say(text, { force = false } = {}) {
    if (!this.enabled || !this.supported || !text) return;
    const now = performance.now();
    if (!force && text === this._lastText) return;
    if (!force && now - this._lastAt < MIN_GAP_MS) return;

    try {
      speechSynthesis.cancel();   // 别排队，积压的旧提示已经过时了
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      const v = this._pickVoice();
      if (v) u.voice = v;
      u.rate = 1.06;
      u.pitch = 1;
      speechSynthesis.speak(u);
      this._lastAt = now;
      this._lastText = text;
    } catch { /* 念不出来不影响别的 */ }
  }

  stop() {
    try { speechSynthesis.cancel(); } catch { /* 忽略 */ }
    this._lastText = '';
  }

  toggle(on) {
    this.enabled = on === undefined ? !this.enabled : Boolean(on);
    if (!this.enabled) this.stop();
    else this.unlock();
    return this.enabled;
  }
}

/** 屏幕上的提示可以长，念出来的必须短——取第一个分句，再兜个底。*/
export function shorten(text, max = 18) {
  if (!text) return '';
  const first = String(text).split(/[。！？\n]/)[0].trim();
  const clause = first.length > max ? first.split(/[，、；]/)[0].trim() : first;
  return (clause || first).slice(0, max + 6);
}
