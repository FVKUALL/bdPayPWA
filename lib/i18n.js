const DEFAULT_I18N = {
  id: {
    app_name: 'bdPay',
    login: 'Masuk',
    register: 'Daftar',
    logout: 'Keluar',
    dashboard: 'Dasbor',
    transfer: 'Transfer',
    ppob: 'PPOB',
    profile: 'Profil',
    save: 'Simpan',
    cancel: 'Batal',
    welcome: 'Selamat datang',
    audible_info: 'Fitur Audible & AI Assistance tersedia untuk aksesibilitas.',
    start_tx: 'Mulai bertransaksi'
  },
  en: {
    app_name: 'bdPay',
    login: 'Login',
    register: 'Register',
    logout: 'Logout',
    dashboard: 'Dashboard',
    transfer: 'Transfer',
    ppob: 'PPOB',
    profile: 'Profile',
    save: 'Save',
    cancel: 'Cancel',
    welcome: 'Welcome',
    audible_info: 'Audible features & AI Assistance available for accessibility.',
    start_tx: 'Start a transaction'
  },
  cn: {
    app_name: 'bdPay',
    login: '登录',
    register: '注册',
    logout: '退出',
    dashboard: '仪表板',
    transfer: '转账',
    ppob: 'PPOB',
    profile: '个人资料',
    save: '保存',
    cancel: '取消',
    welcome: '欢迎',
    audible_info: '提供语音功能与 AI 辅助，方便特殊需求用户。',
    start_tx: '开始交易'
  }
};

function mergeI18n(stored) {
  const out = { id: { ...DEFAULT_I18N.id }, en: { ...DEFAULT_I18N.en }, cn: { ...DEFAULT_I18N.cn } };
  if (stored && typeof stored === 'object') {
    ['id', 'en', 'cn'].forEach(lang => {
      if (stored[lang] && typeof stored[lang] === 'object') Object.assign(out[lang], stored[lang]);
    });
  }
  return out;
}

function t(dict, lang, key) {
  const L = dict[lang] || dict.id || {};
  return L[key] != null ? L[key] : (dict.id && dict.id[key]) || key;
}

module.exports = { DEFAULT_I18N, mergeI18n, t };
