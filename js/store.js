// 本地存储。没有服务器，没有账号，全部数据留在这台设备上。

const NS = 'haohaopai:';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(NS + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value));
    return true;
  } catch {
    return false; // 隐私模式或存储已满
  }
}

function remove(key) {
  try { localStorage.removeItem(NS + key); } catch { /* 忽略 */ }
}

export const store = {
  get survey() { return read('survey', null); },
  set survey(v) { write('survey', v); },

  get apiKey() { return read('apiKey', ''); },
  set apiKey(v) { v ? write('apiKey', v) : remove('apiKey'); },

  get prefs() { return read('prefs', { grid: true, tilt: true }); },
  set prefs(v) { write('prefs', v); },

  get lastTab() { return read('lastTab', 'coach'); },
  set lastTab(v) { write('lastTab', v); },

  exportAll() {
    return { survey: this.survey, prefs: this.prefs, exportedAt: new Date().toISOString() };
  },

  wipe() {
    ['survey', 'apiKey', 'prefs', 'lastTab'].forEach(remove);
  },
};
