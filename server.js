const express = require('express');
const cors = require('cors');
// body-parser optional — express.json used
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ——— TOTP (Google Authenticator) pure Node crypto ———
function base32Encode(buf) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, output = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
function base32Decode(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(str || '').toUpperCase().replace(/=+$/, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0, index = 0;
  const out = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = alphabet.indexOf(clean[i]);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out[index++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}
function verifyTotp(secret, token, window = 1) {
  const t = String(token || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(t) || !secret) return false;
  const key = base32Decode(secret);
  const timestep = Math.floor(Date.now() / 1000 / 30);
  for (let w = -window; w <= window; w++) {
    const counter = Buffer.alloc(8);
    counter.writeUInt32BE(0, 0);
    counter.writeUInt32BE(timestep + w, 4);
    const hmac = crypto.createHmac('sha1', key).update(counter).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
    const str = String(code % 1000000).padStart(6, '0');
    if (str === t) return true;
  }
  return false;
}
function totpOtpauthURL(secret, account = 'admin', issuer = 'bdPay Admin') {
  return 'otpauth://totp/' + encodeURIComponent(issuer + ':' + account) + '?secret=' + secret + '&issuer=' + encodeURIComponent(issuer) + '&algorithm=SHA1&digits=6&period=30';
}


const { v4: uuidv4 } = require('uuid');
const { executePPOB, executePayment } = require('./lib/providers');
const { createOTPRecord, verifyOTPRecord, dispatchOTP } = require('./lib/otp');
const { checkInquiryCooldown, markInquiry } = require('./lib/inquiry_limit');
const { processKYC } = require('./lib/kyc');
const { reverseGeocode } = require('./lib/geo');
const { listKelurahan } = require('./lib/kelurahan');
const { rateLimit, rateLimitForRequest, sanitizeInput, auditEntry, securityHeaders, httpsRedirectMiddleware } = require('./lib/security');
const { signJwt, verifyJwt, extractBearer } = require('./lib/jwt_auth');
const Api = require('./lib/api_response');
const { validateFields, stripProto, isEmail, isNik, isPin6, toAmount } = require('./lib/validate');
const { createPool, getHttpAgent } = require('./lib/pool');
const { requestLogMiddleware, listRequestLogs, clearRequestLogs } = require('./lib/request_log');
const { UMKM_LIMITS, hashPassword, verifyPassword, evaluateAML } = require('./lib/merchant');
const { createCaptcha, verifyCaptcha } = require('./lib/captcha');
const { getMlConfig, evaluateRisk, DEFAULT_ML } = require('./lib/ml_fraud');
const { DEFAULT_FEATURE_MAP, resolveBackend, dbGetAll, dbSaveAll, dbSaveMediaMeta } = require('./lib/db_adapters');
const { runAI, aiCyberAction, DEFAULT_PRIORITY: AI_PRIORITY } = require('./lib/ai_router');
const { listAIActivity } = require('./lib/ai_activity');
const { executeRemittance } = require('./lib/remittance');
const { runApiMonitor, readStore: readApiMonitor } = require('./lib/api_monitor');
const { DEFAULT_I18N, mergeI18n, t: i18nT } = require('./lib/i18n');
const { getPriceCompare, refreshPriceCompare, publicPayload: priceComparePublic } = require('./lib/price_compare');


async function makeQrDataUrl(text) {
  if (!text) return null;
  try {
    const QRCode = require('qrcode');
    return await QRCode.toDataURL(String(text), {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 280,
      color: { dark: '#0f172a', light: '#ffffff' }
    });
  } catch (e) {
    console.warn('[qr] package missing or error:', e.message, '— using SVG fallback');
    // Fallback: visual placeholder (install: npm install qrcode)
    const t = String(text).slice(0, 48).replace(/[<>&]/g, '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="280">
      <rect width="280" height="280" fill="#fff"/>
      <rect x="20" y="20" width="60" height="60" fill="#0f172a"/>
      <rect x="200" y="20" width="60" height="60" fill="#0f172a"/>
      <rect x="20" y="200" width="60" height="60" fill="#0f172a"/>
      <rect x="100" y="100" width="80" height="80" fill="#0f172a"/>
      <text x="140" y="270" text-anchor="middle" font-size="10" fill="#64748b">QRIS sandbox</text>
    </svg>`;
    return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  }
}

const app = express();

app.get('/favicon.svg', (req, res) => {
  try {
    const settings = getSettings();
    const fav = settings.cms?.favicon;
    if (fav && String(fav).startsWith('data:image')) {
      const m = String(fav).match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (m) {
        res.type(m[1]);
        return res.send(Buffer.from(m[2], 'base64'));
      }
    }
  } catch (_) {}
  res.sendFile(require('path').join(__dirname, 'public', 'favicon.svg'));
});
app.get('/favicon.ico', (req, res) => res.redirect(302, '/favicon.svg'));

const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const MEDIA_DIR = path.join(__dirname, 'public', 'media', 'merchants');

/** Simpan dataURL gambar ke disk publik → URL /media/merchants/{id}/{slot}.ext */
function saveMerchantMedia(merchantId, slot, dataUrl) {
  try {
    if (!merchantId || !slot || !dataUrl || typeof dataUrl !== 'string') return null;
    if (dataUrl.startsWith('/media/')) return dataUrl; // already a path
    const m = dataUrl.match(/^data:image\/([\w+.-]+);base64,(.+)$/i);
    if (!m) return null;
    let ext = (m[1] || 'jpeg').toLowerCase().replace('jpeg', 'jpg').replace('+xml', '');
    if (!['jpg', 'png', 'webp', 'gif'].includes(ext)) ext = 'jpg';
    const dir = path.join(MEDIA_DIR, String(merchantId).replace(/[^a-zA-Z0-9_-]/g, '_'));
    fs.mkdirSync(dir, { recursive: true });
    const fname = String(slot).replace(/[^a-zA-Z0-9_-]/g, '_') + '.' + ext;
    const buf = Buffer.from(m[2], 'base64');
    // batasi ~1.5MB
    if (buf.length > 1.5 * 1024 * 1024) {
      console.warn('[media] too large', merchantId, slot, buf.length);
    }
    fs.writeFileSync(path.join(dir, fname), buf);
    const url = '/media/merchants/' + path.basename(dir) + '/' + fname;
    try {
      const settings = (typeof getSettings === 'function') ? getSettings() : null;
      if (settings) {
        dbSaveMediaMeta(settings, { merchant_id: merchantId, slot, url, bytes: buf.length }).catch(() => {});
      }
    } catch (_) {}
    return url;
  } catch (e) {
    console.warn('[media] save failed', e.message);
    return null;
  }
}

function mediaOrKeep(merchantId, slot, dataUrl, prevUrl) {
  const u = saveMerchantMedia(merchantId, slot, dataUrl);
  return u || prevUrl || null;
}



// ========== ENCRYPTION (AES-256-GCM) ==========
const ENC_ALGORITHM = 'aes-256-gcm';
const ENC_KEY_FILE = path.join(__dirname, '.encryption-key');

function getEncryptionKey() {
  if (process.env.ENCRYPTION_KEY) {
    return Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  }
  if (fs.existsSync(ENC_KEY_FILE)) {
    return Buffer.from(fs.readFileSync(ENC_KEY_FILE, 'utf8').trim(), 'hex');
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(ENC_KEY_FILE, key.toString('hex'), { mode: 0o600 });
  console.log('[SECURITY] Generated new encryption key at .encryption-key — BACKUP THIS FILE!');
  return key;
}

const ENC_KEY = getEncryptionKey();

function encrypt(text) {
  if (typeof text !== 'string') text = JSON.stringify(text);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENC_ALGORITHM, ENC_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

function decrypt(encryptedStr) {
  try {
    const parts = encryptedStr.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted format');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const decipher = crypto.createDecipheriv(ENC_ALGORITHM, ENC_KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    console.error('[DECRYPT ERROR]', e.message);
    return null;
  }
}

const ENCRYPTED_FILES = ['users.json', 'transactions.json', 'settings.json', 'otps.json', 'kyc_submissions.json', 'transfers.json'];

function readJSON(filename) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    let raw = fs.readFileSync(filePath, 'utf8');
    if (ENCRYPTED_FILES.includes(filename) && raw.startsWith('ENC:')) {
      const decrypted = decrypt(raw.slice(4));
      if (!decrypted) throw new Error('Decryption failed');
      raw = decrypted;
    }
    return JSON.parse(raw);
  } catch (e) {
    // File belum ada / corrupt → default aman (array untuk koleksi, object untuk settings)
    const arrayFiles = [
      'users', 'transactions', 'faqs', 'products', 'transfers', 'audit_log',
      'merchant_invoices', 'merchant_transactions', 'merchant_messages', 'merchant_schedules',
      'merchants', 'messages', 'otps', 'kyc_submissions', 'ip_lists', 'webhook_logs', 'webhook_live',
      'ai_activity', 'api_monitor'
    ];
    if (arrayFiles.some(k => filename.includes(k))) return [];
    if (filename.includes('settings') || filename.includes('cms') || filename.includes('price_compare')) return {};
    console.error(`Error reading ${filename}:`, e.message);
    return {};
  }
}

function writeJSON(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  let content = JSON.stringify(data, null, 2);
  if (ENCRYPTED_FILES.includes(filename)) {
    content = 'ENC:' + encrypt(content);
  }
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

function writeSettings(s) {
  writeJSON('settings.json', s);
}


async function notifyOmnichannel(event, payload) {
  try {
    const o = (getSettings().omnichannel) || {};
    if (!o.enabled || !o.webhook_url) return;
    await fetch(o.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-bdPay-Secret': o.webhook_secret || '',
        'X-bdPay-Event': event
      },
      body: JSON.stringify({ event, at: new Date().toISOString(), data: payload })
    });
  } catch (e) { console.warn('omnichannel notify', e.message); }
}

function markTransferPaidByVA(vaNumber, provider, payload) {
  if (!vaNumber) return null;
  const list = readJSON('transfers.json');
  const arr = Array.isArray(list) ? list : [];
  let t = arr.find(x => String(x.va_number) === String(vaNumber) && (x.status === 'pending' || x.status === 'waiting_payment'));
  // jika sudah paid, tetap kembalikan
  if (!t) t = arr.find(x => String(x.va_number) === String(vaNumber));
  if (t && t.status !== 'paid' && t.status !== 'success') {
    t.status = 'paid';
    t.paid_at = new Date().toISOString();
    t.callback_received = true;
    t.payment_verified = true;
    t.paid_via = provider || 'bdpay_sandbox';
    try { notifyOmnichannel('payment.paid', { va: vaNumber, provider, order_no: t.order_no }); } catch(_) {}
    t.callback_payload = payload || null;
    writeJSON('transfers.json', arr);
  }
  // Sinkron merchant_transactions.json
  try {
    const mtx = merchantTxFile();
    let changed = false;
    const mi = mtx.findIndex(x => String(x.va_number) === String(vaNumber));
    if (mi >= 0 && mtx[mi].status !== 'paid' && mtx[mi].status !== 'success') {
      mtx[mi].status = 'paid';
      mtx[mi].paid_at = (t && t.paid_at) || new Date().toISOString();
      mtx[mi].paid_via = provider || 'bdpay_sandbox';
      mtx[mi].payment_verified = true;
      changed = true;
      // kredit saldo untuk topup / domestic (penerimaan)
      const mt = mtx[mi];
      if (mt.type === 'saldo_topup' || mt.type === 'domestic_transfer') {
        const merchants = readMerchants();
        const i = merchants.findIndex(x => x.id === mt.merchant_id);
        if (i >= 0) {
          const credit = Number(mt.base_amount != null ? mt.base_amount : mt.amount) || 0;
          if (mt.type === 'saldo_topup') {
            merchants[i].balance = (Number(merchants[i].balance) || 0) + credit;
            merchants[i].accounts = merchants[i].accounts || [];
            if (mt.account && !merchants[i].accounts.find(a => a.account === mt.account && a.bank === mt.bank)) {
              merchants[i].accounts.push({
                id: 'acc-' + Date.now(), bank: mt.bank, account: mt.account, name: mt.name,
                activated_at: new Date().toISOString()
              });
            }
          }
          writeMerchants(merchants);
        }
      }
    }
    if (changed) writeMerchantTx(mtx);
  } catch (e) { console.warn('markTransfer merchant sync', e.message); }
  return t || null;
}

const DEFAULT_TNC = {
  registration: 'Dengan mendaftar, Anda menyetujui Syarat dan Ketentuan layanan bdPay yang dioperasikan oleh PT Berkah Digital Pembayaran, sesuai hukum Republik Indonesia termasuk UU ITE, UU PDP, dan peraturan Bank Indonesia terkait layanan pembayaran. Data pribadi Anda akan dilindungi. Transaksi bersifat final setelah berhasil. PT Berkah Digital Pembayaran berhak menolak transaksi mencurigakan.',
  purchase: 'Dengan melakukan pembelian/transaksi, Anda menyetujui Agreement ini: 1. Memastikan data nomor tujuan benar. 2. Membayar sesuai nominal termasuk biaya layanan dan pajak. 3. Pengembalian dana hanya jika transaksi gagal dari sisi provider. 4. Tidak ada refund untuk kesalahan input pengguna. Sesuai UU Perlindungan Konsumen dan regulasi terkait.',
  aml: 'PERSETUJUAN ANTI MONEY LAUNDERING (AML)\n\nSaya menyatakan bahwa dana yang digunakan dalam setiap transaksi berasal dari sumber yang sah dan tidak terkait tindak pidana pencucian uang atau pendanaan terorisme. Saya bersedia memberikan informasi tambahan apabila diminta sesuai UU No. 8 Tahun 2010 tentang Pencegahan dan Pemberantasan Tindak Pidana Pencucian Uang serta ketentuan PPATK. Transaksi mencurigakan dapat ditolak atau dilaporkan kepada otoritas berwenang.',
  consumer: 'PERSETUJUAN PERLINDUNGAN KONSUMEN\n\nSaya memahami hak dan kewajiban sebagai pengguna layanan sesuai UU No. 8 Tahun 1999 tentang Perlindungan Konsumen. Informasi produk, harga, biaya, dan pajak ditampilkan secara jelas sebelum transaksi. Pengaduan dapat disampaikan melalui Kotak Pesan pada portal. Penyelesaian sengketa mengutamakan musyawarah dan mekanisme yang berlaku di Indonesia.',
  infosec: 'PERSETUJUAN KEAMANAN SISTEM INFORMASI\n\nSaya menyetujui kebijakan keamanan sistem informasi: menjaga kerahasiaan kredensial, tidak membagikan OTP, menggunakan perangkat yang aman, dan segera melaporkan indikasi pelanggaran. Pengelola menerapkan kontrol akses, enkripsi data sensitif, dan pencatatan audit sesuai praktik keamanan informasi yang berlaku.',
  cyber: 'PERSETUJUAN KEAMANAN SIBER\n\nSaya menyadari risiko ancaman siber dan berkomitmen tidak melakukan aktivitas yang membahayakan sistem (termasuk phishing, malware, akses tidak sah). Pengelola dapat memblokir akses, membatasi transaksi, dan melakukan audit keamanan siber jika terdeteksi anomali, sesuai UU ITE dan kebijakan internal keamanan siber.',
  law: 'PERSETUJUAN TAAT HUKUM & PEMBLOKIRAN DANA\n\nSaya tunduk pada hukum Republik Indonesia. Pengelola berhak menunda, menolak, atau memblokir dana/transaksi apabila terdapat perintah otoritas, indikasi fraud, pelanggaran AML, atau sengketa. Pemblokiran dilakukan proporsional dan dapat disertai pemberitahuan melalui kanal resmi portal.'
};

function getSettings() {
  const s = readJSON('settings.json') || {};
  // Kredensial admin selalu tersedia (fallback aman untuk panel)
  if (!s.admin || typeof s.admin !== 'object') s.admin = {};
  if (!s.admin.username) s.admin.username = 'admin';
  if (!s.admin.password) s.admin.password = 'admin123';
  if (!s.tnc) s.tnc = { ...DEFAULT_TNC };
  if (!(s.tnc.registration || '').trim()) s.tnc.registration = DEFAULT_TNC.registration;
  // Normalisasi nama badan hukum di S&K
  if (s.tnc.registration && /AREK ATUR AMANAH/i.test(s.tnc.registration)) {
    s.tnc.registration = s.tnc.registration.replace(/PT\s*AREK ATUR AMANAH/gi, 'PT Berkah Digital Pembayaran');
  }
  if (s.tnc.purchase && /AREK ATUR AMANAH/i.test(s.tnc.purchase)) {
    s.tnc.purchase = s.tnc.purchase.replace(/PT\s*AREK ATUR AMANAH/gi, 'PT Berkah Digital Pembayaran');
  }
  if (!(s.tnc.purchase || '').trim()) s.tnc.purchase = DEFAULT_TNC.purchase;
  ['aml','consumer','infosec','cyber','law'].forEach(k => {
    if (!(s.tnc[k] || '').trim()) s.tnc[k] = DEFAULT_TNC[k] || '';
  });
  if (!s.merchant_limits) s.merchant_limits = { ...UMKM_LIMITS };
  if (!s.ml) s.ml = { ...DEFAULT_ML };
  if (!s.google) s.google = { enabled: true, client_id: '' };
  if (!s.taxes) s.taxes = { items: [] };
  if (!Array.isArray(s.taxes.items)) s.taxes.items = [];
  // Pastikan PPN ada dan aktif default
  let ppn = s.taxes.items.find(i => i.id === 'tax-ppn' || i.name === 'PPN');
  if (!ppn) {
    s.taxes.items.unshift({ id: 'tax-ppn', name: 'PPN', type: 'percent', value: 11, active: true, apply_to: 'all' });
  } else if (ppn.active === undefined) {
    ppn.active = true;
  }
  if (!s.merchant_payment) {
    s.merchant_payment = {
      mode: 'sandbox',
      priority: ['bdpay', 'midtrans', 'doku', 'xendit'],
      webhook_sandbox: true,
      webhook_production: false
    };
  }
  if (!s.databases) {
    s.databases = {
      json: { enabled: true, label: 'JSON Store' },
      lowdb: { enabled: true, label: 'Lowdb' },
      mongodb: { enabled: false, label: 'MongoDB Atlas', uri: '', db_name: 'bdpay' },
      supabase: { enabled: false, label: 'Supabase', url: '', service_key: '', anon_key: '' },
      feature_map: { ...DEFAULT_FEATURE_MAP }
    };
  } else {
    s.databases.feature_map = { ...DEFAULT_FEATURE_MAP, ...(s.databases.feature_map || {}) };
    s.databases.json = s.databases.json || { enabled: true };
    s.databases.lowdb = s.databases.lowdb || { enabled: true };
    s.databases.mongodb = s.databases.mongodb || { enabled: false, uri: '', db_name: 'bdpay' };
    s.databases.supabase = s.databases.supabase || { enabled: false, url: '', service_key: '', anon_key: '' };
  }
  if (!s.i18n) s.i18n = { default_lang: 'id', enabled: true, dict: mergeI18n(null) };
  else s.i18n.dict = mergeI18n(s.i18n.dict);
  if (!s.smtp) {
    s.smtp = {
      enabled: false,
      host: '', port: 587, secure: false,
      user: '', pass: '', from: 'noreply@bdpay.local',
      web_email_enabled: false
    };
  }
  if (!s.sms_gateway) {
    s.sms_gateway = {
      enabled: false,
      provider: 'simulation', // simulation | twilio | nexmo | custom
      api_key: '', api_secret: '', sender_id: 'bdPay',
      base_url: '',
      otp_template: 'Kode OTP bdPay Anda: {{otp}}'
    };
  }
  if (!s.ai) {
    s.ai = {
      enabled: true,
      run_parallel: false,
      priority: ['openai', 'grok', 'gemini', 'groq', 'google_ai_studio', 'deepseek', 'qwen', 'other'],
      tasks: {
        operational: true,
        cyber: true,
        assistance: true,
        ocr_assist: true,
        monitoring: true
      },
      providers: {
        openai: { enabled: false, api_key: '', model: 'gpt-4o-mini', base_url: 'https://api.openai.com/v1' },
        grok: { enabled: false, api_key: '', model: 'grok-3-mini', base_url: 'https://api.x.ai/v1' },
        gemini: { enabled: false, api_key: '', model: 'gemini-3.6-flash', base_url: 'https://generativelanguage.googleapis.com/v1beta' },
        groq: { enabled: false, api_key: '', model: 'openai/gpt-oss-20b', base_url: 'https://api.groq.com/openai/v1' },
        google_ai_studio: { enabled: false, api_key: '', model: 'gemini-3.6-flash', base_url: 'https://generativelanguage.googleapis.com/v1beta' },
        deepseek: { enabled: false, api_key: '', model: 'deepseek-chat', base_url: 'https://api.deepseek.com' },
        qwen: { enabled: false, api_key: '', model: 'qwen-plus', base_url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
        other: { enabled: false, api_key: '', model: '', base_url: '', headers: {} }
      }
    };
  } else {
    // merge defaults for new providers without wiping existing keys
    s.ai.providers = s.ai.providers || {};
    const AI_DEFAULTS = {
      openai: { enabled: false, api_key: '', model: 'gpt-4o-mini', base_url: 'https://api.openai.com/v1' },
      grok: { enabled: false, api_key: '', model: 'grok-3-mini', base_url: 'https://api.x.ai/v1' },
      gemini: { enabled: false, api_key: '', model: 'gemini-3.6-flash', base_url: 'https://generativelanguage.googleapis.com/v1beta' },
      groq: { enabled: false, api_key: '', model: 'openai/gpt-oss-20b', base_url: 'https://api.groq.com/openai/v1' },
      google_ai_studio: { enabled: false, api_key: '', model: 'gemini-3.6-flash', base_url: 'https://generativelanguage.googleapis.com/v1beta' },
      deepseek: { enabled: false, api_key: '', model: 'deepseek-chat', base_url: 'https://api.deepseek.com' },
      qwen: { enabled: false, api_key: '', model: 'qwen-plus', base_url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
      other: { enabled: false, api_key: '', model: '', base_url: '', headers: {} }
    };
    for (const k of Object.keys(AI_DEFAULTS)) {
      s.ai.providers[k] = { ...AI_DEFAULTS[k], ...(s.ai.providers[k] || {}) };
      // keep live default keys if stored key empty
      if (!s.ai.providers[k].api_key && AI_DEFAULTS[k].api_key) {
        s.ai.providers[k].api_key = AI_DEFAULTS[k].api_key;
        s.ai.providers[k].enabled = true;
      }
    }
    if (!Array.isArray(s.ai.priority) || !s.ai.priority.length) {
      s.ai.priority = ['openai', 'grok', 'gemini', 'groq', 'google_ai_studio', 'deepseek', 'qwen', 'other'];
    }
  }
  if (!s.preferred_banks) {
    s.preferred_banks = { enabled: true, codes: ['bni', 'permata'], labels: { bni: 'BNI', permata: 'Permata' } };
  }
  if (!s.api_remittance) {
    s.api_remittance = {
      priority: ['ria', 'moneygram', 'westernunion'],
      mode: 'sandbox',
      ria: { active: true, mode: 'sandbox' },
      moneygram: { active: true, mode: 'sandbox' },
      westernunion: { active: true, mode: 'sandbox' }
    };
  }
  if (!s.audible) {
    s.audible = {
      enabled: true,
      show_on_landing: true,
      show_on_pwa: true,
      show_on_merchant: true,
      tts_lang: 'id-ID',
      ai_assistance: true
    };
  }
  return s;
}

// ========== AUTO SWITCHING (real provider calls via lib/providers.js) ==========
function selectPPOBProvider(settings) {
  const priority = settings.api_ppob?.priority || ['digiflazz', 'iak', 'raja-biller'];
  const providers = settings.api_ppob || {};
  for (const name of priority) {
    const p = providers[name];
    if (p && p.active !== false) return name;
  }
  return priority[0] || 'digiflazz';
}
function selectPaymentProvider(settings) {
  const priority = settings.api_payment?.priority || ['bdpay', 'midtrans', 'doku', 'xendit'];
  const providers = settings.api_payment || {};
  for (const name of priority) {
    const p = providers[name];
    if (p && p.active) return name;
  }
  return priority[0] || 'bdpay';
}

async function executePPOBWithSwitching(product, customerNo, refId, settings) {
  const priority = settings.api_ppob?.priority || ['digiflazz', 'iak', 'raja-biller'];
  const tried = [];
  let lastError = null;

  let ordered = [...priority];
  if (product.provider_api) {
    ordered = [product.provider_api, ...priority.filter(p => p !== product.provider_api)];
  }

  for (const providerName of ordered) {
    const key = providerName.replace('-', '_');
    const conf = settings.api_ppob?.[key] || settings.api_ppob?.[providerName]
      || (providerName === 'raja-biller' ? settings.api_ppob?.raja_biller : null);
    if (!conf || conf.active === false) continue;

    tried.push(providerName);
    try {
      const result = await executePPOB(providerName, conf, {
        sku: product.sku,
        customerNo,
        refId
      });
      if (result.success) {
        return { ...result, provider: providerName, tried };
      }
      lastError = result.message;
    } catch (err) {
      lastError = err.message;
    }
  }

  return {
    success: false,
    provider: tried[tried.length - 1] || null,
    tried,
    message: lastError || 'Semua provider gagal',
    sn: null
  };
}

async function executePaymentWithSwitching(settings, paymentParams) {
  const priority = settings.api_payment?.priority || ['bdpay', 'midtrans', 'doku', 'xendit'];
  const tried = [];
  let lastError = null;

  for (const name of priority) {
    const conf = settings.api_payment?.[name];
    if (!conf || !conf.active) continue;
    tried.push(name);
    try {
      const result = await executePayment(name, conf, paymentParams);
      if (result.success) {
        return { ...result, provider: name, tried };
      }
      lastError = result.message;
    } catch (err) {
      lastError = err.message;
    }
  }
  return {
    success: false,
    provider: tried[tried.length - 1] || null,
    tried,
    message: lastError || 'Semua payment gateway gagal'
  };
}

// ========== CALLBACK VERIFICATION ==========
function verifyDigiflazzCallback(body, settings) {
  const secret = settings.api_ppob?.digiflazz?.api_key || '';
  if (!body || !body.ref_id) return false;
  if (body.signature && secret) {
    const expected = crypto.createHmac('sha256', secret)
      .update(JSON.stringify({ ref_id: body.ref_id, status: body.status || body.buyer_last_status }))
      .digest('hex');
    return body.signature === expected || body.signature === secret;
  }
  return true;
}

function verifyBdPayCallback(body, settings) {
  if (!body || !body.orderNum) return false;
  return true;
}

function verifyMidtransCallback(body, settings) {
  const serverKey = settings.api_payment?.midtrans?.server_key || '';
  if (!body || !body.order_id) return false;
  if (body.signature_key && serverKey) {
    const str = body.order_id + body.status_code + body.gross_amount + serverKey;
    const expected = crypto.createHash('sha512').update(str).digest('hex');
    return body.signature_key === expected;
  }
  return true;
}

function updateTransactionFromCallback(refId, status, sn, source, rawBody) {
  if (!refId) return;
  const transactions = readJSON('transactions.json');
  const idx = transactions.findIndex(t => t.ref_id === refId || t.id === refId);
  if (idx === -1) {
    console.warn('[CALLBACK] Transaction not found:', refId);
    return;
  }
  transactions[idx].status = status;
  transactions[idx].callback_received = true;
  transactions[idx].callback_source = source;
  transactions[idx].callback_at = new Date().toISOString();
  if (sn) transactions[idx].sn = sn;
  transactions[idx].callback_raw = rawBody;
  if (status === 'failed' && !transactions[idx].refunded) {
    transactions[idx].refund_status = transactions[idx].refund_status || 'pending';
  }
  if (status === 'success') {
    delete transactions[idx].refund_status;
  }
  writeJSON('transactions.json', transactions);
  console.log(`[CALLBACK] Updated ${refId} → ${status} via ${source}`);
}

// ========== MIDDLEWARE ==========

app.use(cors());

/** Maintenance: blokir user & merchant (API + page), admin tetap */
function isMaintenanceOn() {
  try {
    const st = getSettings();
    return !!(st.maintenance && st.maintenance.enabled);
  } catch (_) { return false; }
}
app.use((req, res, next) => {
  if (!isMaintenanceOn()) return next();
  const p = req.path || '';
  if (p.startsWith('/api/admin')) return next();
  if (p === '/admin' || p.startsWith('/admin/')) return next();
  if (p === '/robots.txt' || p === '/sitemap.xml' || p.startsWith('/wiki') || p === '/tentang.html' || p === '/portofolio.html') return next();
  if (p.startsWith('/api/')) {
    return res.status(503).json({ success: false, message: 'Sistem dalam maintenance. Silakan coba lagi nanti.', maintenance: true });
  }
  // HTML pages: simple notice
  if (req.accepts('html')) {
    return res.status(503).send(`<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Maintenance</title>
<style>body{font-family:system-ui;background:#0b1220;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.box{max-width:420px;padding:28px;border-radius:16px;background:#111827;border:1px solid #334155;text-align:center}
a{color:#67e8f9}</style></head><body><div class="box"><h1>Maintenance</h1><p>Sistem sedang dalam perawatan. Pengguna &amp; Merchant tidak dapat beroperasi.</p>
<p><a href="/admin/">Admin login</a> · <a href="/tentang.html">Tentang</a></p></div></body></html>`);
  }
  next();
});


app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(requestLogMiddleware({
  getSettings: () => { try { return getSettings(); } catch (_) { return {}; } },
  console: true,
  persist: true
}));
app.use(httpsRedirectMiddleware(() => {
  try { return getSettings(); } catch (_) { return {}; }
}));
app.use((req, res, next) => {
  let settings = {};
  try { settings = getSettings(); } catch (_) {}
  securityHeaders(res, settings);
  const rl = rateLimitForRequest(req, settings);
  res.setHeader('X-RateLimit-Limit', String(rl.limit || 120));
  if (rl.remaining != null) res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
  if (!rl.allowed) {
    return Api.tooMany(res, 'Terlalu banyak permintaan. Coba lagi nanti.', rl.retry_after);
  }
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeInput(stripProto(req.body));
  }
  if (req.query && typeof req.query === 'object') {
    try { req.query = sanitizeInput(stripProto(req.query), 500); } catch (_) {}
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

function checkAdmin(req, res, next) {
  const settings = getSettings();
  const u = (settings.admin && settings.admin.username) || 'admin';
  const p = (settings.admin && settings.admin.password) || 'admin123';
  const expected = Buffer.from(u + ':' + p).toString('base64');
  const token = extractBearer(req) || req.query.token || req.query.admin_token || '';
  if (!token) return Api.unauthorized(res, 'Unauthorized');
  // JWT
  const jwt = verifyJwt(token);
  if (jwt.ok && jwt.payload && jwt.payload.role === 'admin') {
    req.admin = { username: jwt.payload.sub || u, via: 'jwt' };
    return next();
  }
  // Legacy base64 username:password
  if (token === expected) {
    req.admin = { username: u, via: 'legacy' };
    return next();
  }
  return Api.unauthorized(res, 'Unauthorized');
}

function pushAudit(entry) {
  try {
    const logs = readJSON('audit_log.json');
    const arr = Array.isArray(logs) ? logs : [];
    arr.push(entry);
    if (arr.length > 5000) arr.splice(0, arr.length - 5000);
    const filePath = path.join(DATA_DIR, 'audit_log.json');
    fs.writeFileSync(filePath, JSON.stringify(arr, null, 2));
  } catch (e) {
    console.error('audit write fail', e.message);
  }
}

function calcProductFeesAndTax(product, settings) { return calcFeesAndTax(product, settings); }
function calcFeesAndTax(product, settings) {
  let fee = 0;
  let tax = 0;
  const feeLines = [];
  const taxLines = [];
  const price = Number(product.price) || 0;
  const fees = settings.fees || {};
  // Gabungkan item: service + markup + legacy items
  const feeItems = []
    .concat(fees.service?.items || [])
    .concat(fees.markup?.items || [])
    .concat(fees.items || []);
  const taxItems = settings.taxes?.items || settings.taxes || [];

  fee += Number(product.admin_fee) || 0;
  if (product.admin_fee) feeLines.push({ name: 'Admin produk', amount: Number(product.admin_fee) });

  feeItems.filter(i => i && i.active !== false).forEach(i => {
    const amt = i.type === 'percent' ? Math.round(price * (Number(i.value) / 100)) : Number(i.value) || 0;
    fee += amt;
    feeLines.push({ name: i.name || 'Biaya', amount: amt, id: i.id });
  });

  // Pajak dikenakan HANYA pada Biaya Layanan (bukan harga barang)
  const taxList = Array.isArray(taxItems) ? taxItems : (taxItems.items || []);
  taxList.filter(i => i && i.active !== false).forEach(i => {
    const amt = i.type === 'percent' ? Math.round(fee * (Number(i.value) / 100)) : Number(i.value) || 0;
    tax += amt;
    taxLines.push({ name: i.name || 'Pajak', amount: amt, id: i.id });
  });

  return { fee, tax, feeLines, taxLines, total: price + fee + tax };
}

/** Pajak + biaya untuk Domestic Transfer: pajak hanya atas fee */
function calcTransferFeesAndTax(baseAmount, settings) {
  const fees = settings.fees || {};
  const feeCfg = fees.transfer || fees.domestic || {};
  const feeItems = (feeCfg.items && feeCfg.items.length)
    ? feeCfg.items
    : [
        { name: 'Biaya Admin', type: 'fixed', value: 500, active: true },
        { name: 'Biaya Layanan', type: 'percent', value: 1, active: true }
      ];
  let fee = 0;
  const feeLines = [];
  feeItems.filter(i => i && i.active !== false).forEach(i => {
    const amt = i.type === 'percent' ? Math.round(baseAmount * (Number(i.value) / 100)) : Number(i.value) || 0;
    fee += amt;
    feeLines.push({ name: i.name || 'Biaya', amount: amt });
  });
  let tax = 0;
  const taxLines = [];
  const taxList = settings.taxes?.items || settings.taxes || [];
  const list = Array.isArray(taxList) ? taxList : [];
  list.filter(i => i && i.active !== false).forEach(i => {
    const amt = i.type === 'percent' ? Math.round(fee * (Number(i.value) / 100)) : Number(i.value) || 0;
    tax += amt;
    taxLines.push({ name: i.name || 'Pajak', amount: amt });
  });
  return { fee, tax, feeLines, taxLines, totalFee: fee + tax, grand: baseAmount + fee + tax };
}


// ========== PUBLIC API ==========
app.get('/api/public/config', (req, res) => {
  const settings = getSettings();
  const cms = readJSON('cms.json');
  res.json({
    success: true,
    merchant_menu_visibility: { ...(settings.merchant_menu_visibility || {}) },
    data: {
      site: settings.site,
      seo: settings.seo,
      tnc: settings.tnc,
      cms: cms,
      fees: settings.fees,
      taxes: settings.taxes,
      kyc: {
        enabled: settings.kyc?.enabled !== false,
        max_blur_percent: settings.kyc?.max_blur_percent ?? 45,
        min_accuracy_percent: settings.kyc?.min_accuracy_percent ?? 65,
        required_for_purchase: settings.kyc?.required_for_purchase !== false
      },
      otp: { enabled: settings.otp?.enabled !== false },
      google: {
        client_id: settings.google?.client_id || '',
        enabled: settings.google?.enabled !== false
      }
    }
  });
});

// Quote cart: product + fees + tax
app.post('/api/cart/quote', (req, res) => {
  const { product_id } = req.body;
  const products = readJSON('products.json');
  const product = products.find(p => p.id === product_id && p.active);
  if (!product) return res.status(404).json({ success: false, message: 'Produk tidak ditemukan' });
  const settings = getSettings();
  const calc = calcFeesAndTax(product, settings);
  res.json({
    success: true,
    data: {
      product: { id: product.id, name: product.name, price: product.price, sku: product.sku },
      fee: calc.fee,
      tax: calc.tax,
      fee_lines: calc.feeLines,
      tax_lines: calc.taxLines,
      total: calc.total
    }
  });
});

app.get('/api/products', (req, res) => {
  try {
    let products = readJSON('products.json');
    if (!Array.isArray(products)) products = [];
    if (!products.length) {
      products = [
        { id: 'prod-001', name: 'Pulsa Telkomsel 10.000', sku: 'TSEL10', category: 'prabayar', provider: 'Telkomsel', price: 10500, active: true },
        { id: 'prod-002', name: 'Token Listrik PLN 20.000', sku: 'PLN20', category: 'prabayar', provider: 'PLN', price: 20500, active: true },
        { id: 'prod-003', name: 'Tagihan PDAM', sku: 'PDAM', category: 'pascabayar', provider: 'PDAM', price: 0, active: true },
        { id: 'prod-004', name: 'Paket Data XL 5GB', sku: 'XL5GB', category: 'prabayar', provider: 'XL', price: 45000, active: true },
        { id: 'prod-005', name: 'BPJS Kesehatan', sku: 'BPJSKES', category: 'pascabayar', provider: 'BPJS', price: 0, active: true }
      ];
    }
    const category = req.query.category;
    let filtered = products.filter(p => p && p.active !== false);
    if (category) filtered = filtered.filter(p => p.category === category);
    res.json({ success: true, data: filtered });
  } catch (e) {
    console.error('products', e);
    res.status(500).json({ success: false, message: e.message, data: [] });
  }
});


/* —— PPOB Price Comparison (daily) —— */
app.get('/api/price-compare', (req, res) => {
  try {
    const products = readJSON('products.json') || [];
    const store = getPriceCompare(products);
    res.json({ success: true, data: priceComparePublic(store) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
app.post('/api/admin/price-compare/refresh', checkAdmin, async (req, res) => {
  try {
    const products = readJSON('products.json') || [];
    let aiSummary = null;
    try {
      const ai = await runAI(getSettings(), 'operational',
        'Buat 1 kalimat ajakan bertransaksi PPOB di bdPay berdasarkan komparasi harga harian. Bahasa Indonesia, singkat.',
        'Copywriter fintech Indonesia.');
      if (ai.success && ai.text) aiSummary = String(ai.text).slice(0, 280);
    } catch (_) {}
    const store = refreshPriceCompare(products, { force: true, aiSummary });
    res.json({ success: true, message: 'Komparasi harga diperbarui', data: priceComparePublic(store) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/faqs', (req, res) => {
  const faqs = readJSON('faqs.json');
  const active = faqs.filter(f => f.active).sort((a, b) => a.order - b.order);
  res.json({ success: true, data: active });
});



// ========== PIN 6 digit ==========
function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin) + '|bdpay-pin').digest('hex');
}
function verifyPinHash(pin, hash) {
  if (!hash) return false;
  return hashPin(pin) === hash;
}

app.post('/api/pin/set', (req, res) => {
  const { user_id, pin, old_pin } = req.body || {};
  if (!/^\d{6}$/.test(String(pin || ''))) return res.status(400).json({ success: false, message: 'PIN harus 6 digit angka' });
  const users = readJSON('users.json');
  const i = users.findIndex(u => u.id === user_id);
  if (i < 0) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
  if (users[i].pin_hash && !verifyPinHash(old_pin, users[i].pin_hash)) {
    return res.status(403).json({ success: false, message: 'PIN lama salah' });
  }
  users[i].pin_hash = hashPin(pin);
  users[i].pin_set_at = new Date().toISOString();
  writeJSON('users.json', users);
  pushAudit(auditEntry({ action: 'pin_set', actor: users[i].email, ip: req.ip }));
  res.json({ success: true, message: 'PIN berhasil disimpan' });
});

app.post('/api/pin/verify', (req, res) => {
  const { user_id, pin } = req.body || {};
  const users = readJSON('users.json');
  const u = users.find(x => x.id === user_id);
  if (!u) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
  if (u.status === 'on_hold') return res.status(403).json({ success: false, message: 'Akun On-Hold' });
  if (!u.pin_hash) return res.status(400).json({ success: false, message: 'PIN belum diatur', code: 'PIN_NOT_SET' });
  if (!verifyPinHash(pin, u.pin_hash)) return res.status(403).json({ success: false, message: 'PIN salah' });
  res.json({ success: true, message: 'PIN OK' });
});

app.post('/api/merchant/pin/set', requireMerchant, (req, res) => {
  const { pin, old_pin } = req.body || {};
  if (!/^\d{6}$/.test(String(pin || ''))) return res.status(400).json({ success: false, message: 'PIN harus 6 digit angka' });
  const list = readMerchants();
  const i = list.findIndex(x => x.id === req.merchant.id);
  if (i < 0) return res.status(404).json({ success: false });
  if (list[i].pin_hash && !verifyPinHash(old_pin, list[i].pin_hash)) {
    return res.status(403).json({ success: false, message: 'PIN lama salah' });
  }
  list[i].pin_hash = hashPin(pin);
  list[i].pin_set_at = new Date().toISOString();
  writeMerchants(list);
  res.json({ success: true, message: 'PIN merchant disimpan' });
});

app.post('/api/merchant/pin/verify', requireMerchant, (req, res) => {
  const { pin } = req.body || {};
  const m = req.merchant;
  if (m.status === 'on_hold') return res.status(403).json({ success: false, message: 'Akun On-Hold' });
  if (!m.pin_hash) return res.status(400).json({ success: false, message: 'PIN belum diatur', code: 'PIN_NOT_SET' });
  if (!verifyPinHash(pin, m.pin_hash)) return res.status(403).json({ success: false, message: 'PIN salah' });
  res.json({ success: true, message: 'PIN OK' });
});

// ========== CAPTCHA ==========
app.get('/api/captcha', (req, res) => {
  const c = createCaptcha();
  res.json({ success: true, data: c });
});

app.post('/api/register', (req, res) => {
  const { email, bank_account, bank_name, account_holder, phone, tnc_accepted, captcha_id, captcha_answer } = req.body;
  const cap = verifyCaptcha(captcha_id, captcha_answer);
  if (!cap.ok) return res.status(400).json({ success: false, message: cap.message });
  const emailNorm = String(email || '').trim().toLowerCase();
  if (!emailNorm || !emailNorm.includes('@')) {
    return res.status(400).json({ success: false, message: 'Email wajib diisi' });
  }
  // Username otomatis dari bagian lokal email (tanpa input Nama Pengguna)
  let username = String(req.body.username || emailNorm.split('@')[0] || 'user')
    .toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 24) || 'user';
  const users = readJSON('users.json');
  if (users.find(u => u.email === emailNorm)) {
    return res.status(400).json({ success: false, message: 'Email sudah terdaftar' });
  }
  // pastikan username unik
  let base = username, n = 1;
  while (users.find(u => u.username === username)) {
    username = (base + n).slice(0, 24);
    n++;
  }
  const newUser = {
    id: uuidv4(),
    email: emailNorm,
    username,
    phone: phone || '',
    bank_account: bank_account || '',
    bank_name: bank_name || '',
    account_holder: account_holder || '',
    created_at: new Date().toISOString(),
    balance: 0,
    tnc_accepted: true,
    agreement_accepted: false,
    email_verified: false,
    kyc_status: 'pending',
    kyc_data: {},
    profile: {
      nama_ktp: '',
      nik: '',
      phone: phone || '',
      email: emailNorm,
      kelurahan: '',
      kecamatan: '',
      kota: '',
      kode_pos: '',
      lat: null,
      lng: null
    },
    auth_provider: 'local',
    status: 'active',
    pin_hash: null,
    known_devices: [],
    known_locations: [],
    risk_score: 1
  };
  users.push(newUser);
  writeJSON('users.json', users);

  // Auto-create OTP for email verification
  const settings = getSettings();
  const otps = readJSON('otps.json');
  const rec = createOTPRecord(email, 'email', settings);
  otps.push(rec);
  writeJSON('otps.json', otps);
  pushAudit(auditEntry({ action: 'register', actor: email, ip: req.ip, detail: { username } }));

  const payload = { id: newUser.id, email, username, email_verified: false, kyc_status: 'pending' };
  if (settings.otp?.demo_mode !== false) payload.demo_otp = rec.code;
  res.json({
    success: true,
    message: 'Registrasi berhasil. Verifikasi email dengan OTP yang dikirim.',
    data: payload
  });
});

app.post('/api/login', (req, res) => {
  const { identifier, captcha_id, captcha_answer, demo } = req.body || {};
  const idf = String(identifier || '').toLowerCase().trim();
  const isDemo = demo === true || idf === 'demo';
  const cap = verifyCaptcha(captcha_id, captcha_answer);
  if (!cap.ok && !isDemo) return res.status(400).json({ success: false, message: cap.message });
  if (!identifier) return res.status(400).json({ success: false, message: 'Identifier wajib' });
  const users = readJSON('users.json');
  let user = users.find(u => u.email === identifier || u.username === identifier);
  if (!user && isDemo) {
    user = users.find(u => u.username === 'demo' || u.email === 'demo@bdpay.local');
    if (!user) {
      user = {
        id: uuidv4(), email: 'demo@bdpay.local', username: 'demo', phone: '081234567890',
        created_at: new Date().toISOString(), balance: 0, status: 'active',
        email_verified: true, kyc_status: 'approved', profile_completed: true,
        tnc_accepted: true, agreement_accepted: true, pin_hash: hashPin('123456'),
        profile: { nama_ktp: 'DEMO USER', nik: '3174010101010001', phone: '081234567890', email: 'demo@bdpay.local', kota: 'Jakarta', kecamatan: 'Menteng', kode_pos: '10310' }
      };
      users.push(user);
      writeJSON('users.json', users);
    }
  }
  if (!user) return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan' });
  if (user.status === 'on_hold') return res.status(403).json({ success: false, message: 'Akun On-Hold oleh admin' });
  pushAudit(auditEntry({ action: 'login', actor: user.email, ip: req.ip, detail: {} }));
  res.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      username: user.username,
      bank_account: user.bank_account,
      bank_name: user.bank_name,
      account_holder: user.account_holder,
      balance: user.balance,
      auth_provider: user.auth_provider || 'local',
      email_verified: !!user.email_verified,
      kyc_status: user.kyc_status || 'pending',
      profile_completed: !!user.profile_completed,
      pin_set: !!user.pin_hash,
      profile: user.profile || {},
      phone: user.phone || user.profile?.phone || '',
      status: user.status || 'active',
      pin_set: !!user.pin_hash
    }
  });
});

// —— OTP ——
app.post('/api/otp/send', async (req, res) => {
  const { email, phone, channel } = req.body;
  const ch = (channel || (phone && !email ? 'whatsapp' : 'email')).toLowerCase();
  const target = ch === 'email' ? email : phone;
  if (!target) return res.status(400).json({ success: false, message: ch === 'email' ? 'Email wajib' : 'Nomor telepon wajib' });
  const settings = getSettings();
  if (settings.otp?.enabled === false) {
    return res.status(400).json({ success: false, message: 'OTP dinonaktifkan' });
  }
  if (ch !== 'email' && !/^08\d{8,12}$|^\+62\d{9,13}$/.test(String(phone || '').replace(/[\s-]/g, ''))) {
    // normalize loose check
  }
  const otps = readJSON('otps.json');
  const rec = createOTPRecord(target, ch, settings);
  otps.push(rec);
  writeJSON('otps.json', otps);
  await dispatchOTP({ channel: ch, target, code: rec.code, settings });
  pushAudit(auditEntry({ action: 'otp_send', actor: String(target), ip: req.ip, detail: { channel: ch } }));
  const data = { channel: ch, target, expires_at: rec.expires_at };
  if (settings.otp?.demo_mode !== false) data.demo_otp = rec.code;
  res.json({
    success: true,
    message: ch === 'email' ? 'OTP dikirim ke email' : (ch === 'sms' ? 'OTP dikirim via SMS' : 'OTP dikirim via WhatsApp') + ' (demo: lihat kode di response)',
    data
  });
});

app.post('/api/otp/verify', (req, res) => {
  const { email, phone, code, user_id, change_email, channel } = req.body;
  const target = email || phone;
  if (!target || !code) return res.status(400).json({ success: false, message: 'Target dan kode OTP wajib' });
  const otps = readJSON('otps.json');
  const result = verifyOTPRecord(otps, target, code, channel);
  writeJSON('otps.json', otps);
  if (!result.ok) return res.status(400).json({ success: false, message: result.message });

  const users = readJSON('users.json');
  let idx = -1;
  if (user_id) idx = users.findIndex(u => u.id === user_id);
  if (idx < 0) idx = users.findIndex(u => u.email === email);

  if (change_email && user_id) {
    idx = users.findIndex(u => u.id === user_id);
    if (idx < 0) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    if (users.find(u => u.email === email && u.id !== user_id)) {
      return res.status(400).json({ success: false, message: 'Email sudah dipakai akun lain' });
    }
    users[idx].email = email;
    users[idx].email_verified = true;
    if (!users[idx].profile) users[idx].profile = {};
    users[idx].profile.email = email;
    writeJSON('users.json', users);
    pushAudit(auditEntry({ action: 'email_change', actor: email, ip: req.ip, detail: { user_id } }));
    return res.json({
      success: true,
      message: 'Email diperbarui dan terverifikasi.',
      data: { email_verified: true, email }
    });
  }

  if (idx >= 0) {
    users[idx].email_verified = true;
    writeJSON('users.json', users);
  }
  pushAudit(auditEntry({ action: 'otp_verify', actor: email, ip: req.ip, detail: { ok: true } }));
  res.json({ success: true, message: result.message, data: { email_verified: true, email } });
});

// —— Profile ——
app.get('/api/user/:id/profile', (req, res) => {
  const users = readJSON('users.json');
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
  res.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      username: user.username,
      phone: user.phone || user.profile?.phone,
      email_verified: !!user.email_verified,
      kyc_status: user.kyc_status || 'pending',
      tnc_accepted: !!user.tnc_accepted,
      agreement_accepted: !!user.agreement_accepted,
      profile_completed: !!user.profile_completed,
      profile: user.profile || {},
      has_ktp: !!(user.ktp_image),
      ktp_image: user.ktp_image || null,
      ktp_processed: user.ktp_processed || null,
      bank_account: user.bank_account,
      bank_name: user.bank_name,
      account_holder: user.account_holder
    }
  });
});

app.put('/api/user/:id/profile', (req, res) => {
  const users = readJSON('users.json');
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx < 0) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
  const body = req.body || {};
  const u = users[idx];

  if (!u.email_verified) {
    return res.status(400).json({ success: false, message: 'Verifikasi email (OTP) terlebih dahulu.' });
  }
  if (u.kyc_status !== 'approved' || !u.profile?.nama_ktp || !u.profile?.nik) {
    return res.status(400).json({ success: false, message: 'Lakukan OCR KTP terlebih dahulu (Nama & NIK).' });
  }
  if (!body.kecamatan || !body.kota || !body.kode_pos) {
    return res.status(400).json({ success: false, message: 'Ambil lokasi GPS terlebih dahulu (kecamatan, kota, kode pos).' });
  }
  if (!body.tnc_accepted) {
    return res.status(400).json({ success: false, message: 'Baca dan setujui T&C terlebih dahulu.' });
  }
  if (!body.agreement_accepted) {
    return res.status(400).json({ success: false, message: 'Baca dan setujui Agreement terlebih dahulu.' });
  }

  const p = u.profile || {};
  // Nama & NIK dari OCR boleh diedit
  if (body.nama_ktp !== undefined) p.nama_ktp = body.nama_ktp;
  if (body.nik !== undefined) p.nik = body.nik;
  if (body.phone !== undefined) {
    p.phone = body.phone;
    u.phone = body.phone;
  }
  p.email = u.email;
  // Geo hanya dari GPS (client kirim hasil GPS, bukan ketikan bebas untuk kecamatan/kota/kode_pos)
  p.kecamatan = body.kecamatan;
  p.kota = body.kota;
  p.kode_pos = body.kode_pos;
  if (body.kelurahan !== undefined) p.kelurahan = body.kelurahan;
  if (body.lat !== undefined) p.lat = body.lat;
  if (body.lng !== undefined) p.lng = body.lng;

  u.tnc_accepted = true;
  u.agreement_accepted = true;
  u.profile_completed = true;
  if (p.nama_ktp && p.nik && String(p.nik).length === 16) {
    u.kyc_status = 'approved';
  }

  u.profile = p;
  if (body.bank_account !== undefined) u.bank_account = body.bank_account;
  if (body.bank_name !== undefined) u.bank_name = body.bank_name;
  if (body.account_holder !== undefined) u.account_holder = body.account_holder;

  users[idx] = u;
  writeJSON('users.json', users);
  pushAudit(auditEntry({ action: 'profile_save', actor: u.email, ip: req.ip, detail: { completed: true } }));
  res.json({
    success: true,
    message: 'Profil berhasil disimpan.',
    data: {
      profile: u.profile,
      tnc_accepted: true,
      agreement_accepted: true,
      profile_completed: true
    }
  });
});

// —— GEO ——
app.post('/api/geo/reverse', async (req, res) => {
  const { lat, lng } = req.body;
  const result = await reverseGeocode(lat, lng);
  if (!result.ok) return res.status(400).json({ success: false, message: result.message });
  const kelurahanList = await listKelurahan(result.kecamatan);
  res.json({
    success: true,
    data: {
      ...result,
      kelurahan_list: kelurahanList
    }
  });
});

app.get('/api/geo/kelurahan', async (req, res) => {
  const kecamatan = req.query.kecamatan || '';
  try {
    const list = await listKelurahan(kecamatan);
    res.json({ success: true, data: { kecamatan, kelurahan_list: list } });
  } catch (e) {
    res.json({ success: true, data: { kecamatan, kelurahan_list: [] } });
  }
});

// —— KYC OCR (langkah awal: isi Nama + NIK; KTP disimpan; T&C/Agreement di langkah akhir simpan profil) ——
app.post('/api/kyc/submit', async (req, res) => {
  const { user_id, imageBase64, filename, hint, ocr_text, ocr_text_by_rotation, bypass, watermark_client } = req.body;
  if (!user_id) return res.status(400).json({ success: false, message: 'user_id wajib' });
  if (!bypass && !imageBase64) return res.status(400).json({ success: false, message: 'Foto KTP wajib diunggah (atau centang Lewati OCR)' });

  const users = readJSON('users.json');
  const idx = users.findIndex(u => u.id === user_id);
  if (idx < 0) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });

  const settings = getSettings();
  const result = await processKYC({
    imageBase64, filename, hint, settings,
    ocrText: ocr_text, ocrTextByRotation: ocr_text_by_rotation,
    bypass: !!bypass, watermark_client,
    engineeredDataUrl: req.body.engineeredDataUrl || req.body.engineered_data_url,
    nikCropDataUrl: req.body.nikCropDataUrl || req.body.nik_crop_data_url,
    namaCropDataUrl: req.body.namaCropDataUrl || req.body.nama_crop_data_url
  });

  const submission = {
    id: uuidv4(),
    user_id,
    created_at: new Date().toISOString(),
    result_code: result.code,
    quality: result.quality,
    ocr: result.ocr,
    ok: result.ok,
    has_image: true
  };
  const subs = readJSON('kyc_submissions.json');
  const subArr = Array.isArray(subs) ? subs : [];
  subArr.push(submission);
  writeJSON('kyc_submissions.json', subArr);

  // Simpan: KTP watermarked (admin) + rekayasa 1024x648 B&W (admin)
  users[idx].ktp_filename = filename || 'ktp.jpg';
  users[idx].ktp_uploaded_at = new Date().toISOString();
  if (result.original_image && result.original_image.length < 12000000) {
    users[idx].ktp_image = result.original_image;
  } else if (imageBase64 && imageBase64.length < 6000000) {
    users[idx].ktp_image = imageBase64;
  }
  if (result.processed_image && result.processed_image.length < 12000000) {
    users[idx].ktp_processed = result.processed_image;
  }
  if (result.crop_nik && result.crop_nik.length < 2000000) {
    users[idx].ktp_crop_nik = result.crop_nik;
  }
  if (result.crop_nama && result.crop_nama.length < 2000000) {
    users[idx].ktp_crop_nama = result.crop_nama;
  }

  if (!result.ok) {
    users[idx].kyc_status = 'rejected';
    writeJSON('users.json', users);
    pushAudit(auditEntry({ action: 'kyc_reject', actor: users[idx].email, ip: req.ip, detail: { code: result.code }, level: 'warn' }));
    return res.status(400).json({
      success: false,
      message: result.message,
      data: { quality: result.quality, ocr: result.ocr, code: result.code }
    });
  }

  const ocr = result.ocr || {};
  const bothMatch = !!(result.lock_nik && result.lock_nama);
  users[idx].kyc_status = bothMatch ? 'approved' : (result.kyc_status || 'pending');
  users[idx].kyc_data = ocr;
  users[idx].profile = {
    ...(users[idx].profile || {}),
    nama_ktp: ocr.nama_ktp || (users[idx].profile && users[idx].profile.nama_ktp) || '',
    nik: ocr.nik || (users[idx].profile && users[idx].profile.nik) || '',
    phone: users[idx].phone || users[idx].profile?.phone || '',
    email: users[idx].email
  };
  writeJSON('users.json', users);
  pushAudit(auditEntry({ action: 'kyc_ocr_ok', actor: users[idx].email, ip: req.ip, detail: { code: result.code, nik: ocr.nik } }));
  res.json({
    success: true,
    message: result.message || 'OCR selesai. Periksa Nama & NIK.',
    data: {
      kyc_status: users[idx].kyc_status,
      quality: result.quality,
      nama_ktp: ocr.nama_ktp || '',
      nik: ocr.nik || '',
      ocr: ocr,
      profile: users[idx].profile,
      has_ktp: true,
      code: result.code,
      raw_preview: ocr.raw_preview || '',
      allow_manual: !!result.allow_manual,
      has_processed: !!result.processed_image,
      processed_image: result.processed_image || null,
      verify_image: result.verify_image || result.nama_upscale_image || null,
      nik_upscale_image: result.nik_upscale_image || null,
      nama_upscale_image: result.nama_upscale_image || null,
      lock_nik: !!result.lock_nik,
      lock_nama: !!result.lock_nama
    }
  });
});

// Google Sign-In / Register (credential = JWT dari Google Identity Services)
// Mode demo: jika client_id kosong atau token demo, terima payload langsung
app.post('/api/auth/google', (req, res) => {
  const { credential, demo_payload } = req.body;
  const settings = getSettings();
  const googleCfg = settings.google || {};

  let email, name, googleId, picture;

  if (demo_payload) {
    // Demo Google login (tombol "Lanjutkan dengan Google (Demo)")
    email = demo_payload.email;
    name = demo_payload.name || (email || '').split('@')[0];
    googleId = demo_payload.sub || 'demo-google-' + Date.now();
    picture = demo_payload.picture || '';
  } else if (credential) {
    // Decode JWT payload (tanpa verifikasi signature di demo;
    // production: verifikasi dengan google-auth-library / jwks)
    try {
      const parts = credential.split('.');
      if (parts.length !== 3) throw new Error('Invalid JWT');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      email = payload.email;
      name = payload.name || payload.given_name || email.split('@')[0];
      googleId = payload.sub;
      picture = payload.picture || '';
      if (googleCfg.client_id && payload.aud !== googleCfg.client_id) {
        return res.status(401).json({ success: false, message: 'Invalid Google audience' });
      }
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Invalid Google credential: ' + e.message });
    }
  } else {
    return res.status(400).json({ success: false, message: 'Credential atau demo_payload wajib' });
  }

  if (!email) return res.status(400).json({ success: false, message: 'Email Google tidak ditemukan' });

  const users = readJSON('users.json');
  let user = users.find(u => u.email === email || u.google_id === googleId);

  if (!user) {
    // Auto-register
    const baseUsername = (name || email.split('@')[0]).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'user';
    let username = baseUsername;
    let i = 1;
    while (users.find(u => u.username === username)) {
      username = baseUsername + i;
      i++;
    }
    user = {
      id: uuidv4(),
      email: String(email).trim().toLowerCase(),
      username,
      google_id: googleId,
      picture,
      bank_account: '',
      bank_name: '',
      account_holder: '',
      created_at: new Date().toISOString(),
      balance: 0,
      tnc_accepted: true,
      agreement_accepted: false,
      email_verified: true, // Google sudah memverifikasi email
      kyc_status: 'pending',
      profile_completed: false,
      profile: { email, nama_ktp: '', nik: '', phone: '', kelurahan: '', kecamatan: '', kota: '', kode_pos: '' },
      auth_provider: 'google'
    };
    users.push(user);
    writeJSON('users.json', users);
  } else {
    user.google_id = googleId;
    user.picture = picture || user.picture;
    user.auth_provider = user.auth_provider || 'google';
    if (user.email_verified !== true) user.email_verified = true;
    const idx = users.findIndex(u => u.id === user.id);
    users[idx] = user;
    writeJSON('users.json', users);
  }

  if (user.status === 'on_hold') return res.status(403).json({ success: false, message: 'Akun On-Hold oleh admin' });
  res.json({
    success: true,
    message: 'Login Google berhasil. Lengkapi profil jika belum.',
    data: {
      id: user.id,
      email: user.email,
      username: user.username,
      bank_account: user.bank_account,
      bank_name: user.bank_name,
      account_holder: user.account_holder,
      balance: user.balance,
      picture: user.picture,
      auth_provider: 'google',
      email_verified: true,
      kyc_status: user.kyc_status || 'pending',
      profile_completed: !!user.profile_completed,
      profile: user.profile || {}
    }
  });
});

// Public demo account info
app.get('/api/public/demo-account', (req, res) => {
  res.json({
    success: true,
    data: {
      identifier: 'demo',
      email: 'demo@ppob.local',
      username: 'demo',
      note: 'Klik untuk login cepat sebagai demo (tanpa password)'
    }
  });
});

app.post('/api/order', async (req, res) => {
  const { user_id, product_id, customer_no, payment_method, agreement_accepted } = req.body;
  if (!agreement_accepted) {
    return res.status(400).json({ success: false, message: 'Anda harus menyetujui Agreement pembelian' });
  }

  const products = readJSON('products.json');
  const product = products.find(p => p.id === product_id && p.active);
  if (!product) return res.status(404).json({ success: false, message: 'Produk tidak ditemukan atau nonaktif' });

  const users = readJSON('users.json');
  const user = users.find(u => u.id === user_id);
  if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });

  const settings = getSettings();
  if (!user.profile_completed) {
    return res.status(403).json({
      success: false,
      message: 'Lengkapi dan simpan Profil terlebih dahulu sebelum pembelian.',
      code: 'PROFILE_INCOMPLETE'
    });
  }
  if (settings.kyc?.required_for_purchase && user.kyc_status !== 'approved') {
    return res.status(403).json({
      success: false,
      message: 'Lengkapi verifikasi KYC (OCR KTP) di Profil sebelum melakukan pembelian.',
      code: 'KYC_REQUIRED'
    });
  }
  if (settings.otp?.enabled !== false && !user.email_verified) {
    return res.status(403).json({
      success: false,
      message: 'Verifikasi email via OTP terlebih dahulu di Profil.',
      code: 'EMAIL_NOT_VERIFIED'
    });
  }

  const calc = calcFeesAndTax(product, settings);
  const fee = calc.fee;
  const tax = calc.tax;
  const total = calc.total;
  const ref_id = 'TRX-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6).toUpperCase();

  // 1) Buat pembayaran via payment gateway (auto-switch)
  const host = req.protocol + '://' + req.get('host');
  const payResult = await executePaymentWithSwitching(settings, {
    orderId: ref_id,
    amount: total,
    method: payment_method || 'qris',
    name: user.account_holder || user.username,
    email: user.email,
    phone: customer_no,
    customer: { name: user.account_holder || user.username, email: user.email, phone: customer_no },
    notifyUrl: host + '/api/callback/bdpay',
    callbackUrl: host + '/api/callback/doku',
    successUrl: host + '/?paid=1',
    failureUrl: host + '/?paid=0'
  });

  // 2) Proses PPOB via provider (auto-switch) — di production bisa ditunda sampai payment settled via callback
  const ppobResult = await executePPOBWithSwitching(product, customer_no, ref_id, settings);

  // Pembayaran dulu: status menunggu bayar (simulasi/callback)
  let status = 'waiting_payment';
  if (!ppobResult.success && !payResult.va_number && !payResult.qr_string && !payResult.payment_url) {
    status = 'failed';
  }
  
  let qr_image = null;
  const qrPayload = payResult.qr_string || (payment_method === 'qris' ? ('00020101' + ref_id) : null);
  if (qrPayload || (payment_method === 'qris' && payResult.va_number)) {
    qr_image = await makeQrDataUrl(payResult.qr_string || payResult.payment_url || payResult.va_number || ref_id);
  }

const transaction = {
    id: uuidv4(),
    ref_id,
    user_id,
    product_id,
    product_name: product.name,
    product_sku: product.sku,
    customer_no,
    amount: product.price,
    fee,
    tax,
    fee_lines: calc.feeLines,
    tax_lines: calc.taxLines,
    total,
    payment_method: payment_method || 'qris',
    provider_ppob: ppobResult.provider,
    provider_ppob_tried: ppobResult.tried || [],
    provider_payment: payResult.provider,
    provider_payment_tried: payResult.tried || [],
    status,
    sn: ppobResult.sn || null,
    message: ppobResult.message,
    payment_url: payResult.payment_url || null,
    va_number: payResult.va_number || null,
    va_bank: payResult.va_bank || null,
    qr_string: payResult.qr_string || null,
    qr_image: qr_image || null,
    payment_simulated: !!payResult.simulated,
    ppob_simulated: !!ppobResult.simulated,
    created_at: new Date().toISOString(),
    refunded: false,
    callback_received: false
  };

  if (!ppobResult.success) {
    transaction.refund_status = 'pending';
    transaction.refund_to = {
      bank: user.bank_name,
      account: user.bank_account,
      holder: user.account_holder
    };
  }

  const transactions = readJSON('transactions.json');
  transactions.push(transaction);
  writeJSON('transactions.json', transactions);

  res.json({
    success: true,
    data: {
      ref_id,
      transaction_id: transaction.id,
      status,
      total,
      fee,
      tax,
      fee_lines: calc.feeLines,
      tax_lines: calc.taxLines,
      sn: transaction.sn,
      provider_ppob: ppobResult.provider,
      provider_ppob_tried: ppobResult.tried,
      provider_payment: payResult.provider,
      provider_payment_tried: payResult.tried,
      message: ppobResult.message,
      payment_url: payResult.payment_url,
      va_number: payResult.va_number,
      va_bank: payResult.va_bank,
      qr_string: payResult.qr_string || (payment_method === 'qris' ? '00020101021226DEMO' + ref_id : null),
      qr_image: qr_image || null,
      simulated: {
        payment: !!payResult.simulated,
        ppob: !!ppobResult.simulated
      }
    }
  });
});

// ========== RECEIPT ==========
app.get('/api/receipt/:ref_id', (req, res) => {
  const transactions = readJSON('transactions.json');
  const tx = transactions.find(t => t.ref_id === req.params.ref_id || t.id === req.params.ref_id);
  if (!tx) return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });

  const settings = getSettings();
  const users = readJSON('users.json');
  const user = users.find(u => u.id === tx.user_id);

  const receipt = {
    company: settings.site?.name || 'PPOB Mobile',
    copyright: settings.site?.copyright || 'bdPay',
    ref_id: tx.ref_id,
    date: tx.created_at,
    product: tx.product_name,
    sku: tx.product_sku,
    customer_no: tx.customer_no,
    amount: tx.amount,
    fee: tx.fee,
    tax: tx.tax || 0,
    fee_lines: tx.fee_lines || [],
    tax_lines: tx.tax_lines || [],
    total: tx.total,
    status: tx.status,
    sn: tx.sn,
    provider: tx.provider_ppob,
    payment_method: tx.payment_method,
    payment_provider: tx.provider_payment,
    customer: user ? { username: user.username, email: user.email } : null,
    message: tx.message
  };

  if (req.query.format === 'html' || (req.headers.accept && req.headers.accept.includes('text/html'))) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(generateReceiptHTML(receipt));
  }
  res.json({ success: true, data: receipt });
});

function generateReceiptHTML(r) {
  const statusColor = r.status === 'success' ? '#198754' : '#dc3545';
  const statusText = r.status === 'success' ? 'BERHASIL' : 'GAGAL';
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Struk ${r.ref_id}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Courier New', monospace; background: #f5f5f5; padding: 20px; }
    .receipt { max-width: 320px; margin: 0 auto; background: #fff; padding: 24px; border: 1px dashed #ccc; }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .line { border-top: 1px dashed #999; margin: 12px 0; }
    .row { display: flex; justify-content: space-between; margin: 4px 0; font-size: 13px; }
    .status { color: ${statusColor}; font-size: 18px; font-weight: bold; margin: 8px 0; }
    .sn { background: #f0f0f0; padding: 8px; margin: 8px 0; word-break: break-all; font-size: 12px; }
    @media print {
      body { background: #fff; padding: 0; }
      .no-print { display: none; }
      .receipt { border: none; max-width: 100%; }
    }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="center bold" style="font-size:16px">${r.company}</div>
    <div class="center" style="font-size:11px;color:#666">${r.copyright}</div>
    <div class="line"></div>
    <div class="center status">${statusText}</div>
    <div class="row"><span>No. Ref</span><span class="bold">${r.ref_id}</span></div>
    <div class="row"><span>Tanggal</span><span>${new Date(r.date).toLocaleString('id-ID')}</span></div>
    <div class="line"></div>
    <div class="row"><span>Produk</span><span>${r.product}</span></div>
    <div class="row"><span>SKU</span><span>${r.sku || '-'}</span></div>
    <div class="row"><span>No. Tujuan</span><span class="bold">${r.customer_no}</span></div>
    <div class="line"></div>
    <div class="row"><span>Harga</span><span>Rp ${Number(r.amount).toLocaleString('id-ID')}</span></div>
    <div class="row"><span>Biaya Layanan</span><span>Rp ${Number(r.fee||0).toLocaleString('id-ID')}</span></div>
    ${(r.tax_lines && r.tax_lines.length ? r.tax_lines : (r.tax ? [{name:'Pajak',amount:r.tax}] : [])).map(t => `<div class="row"><span>${(t.name||'Pajak').replace(/</g,'')}</span><span>Rp ${Number(t.amount||0).toLocaleString('id-ID')}</span></div>`).join('')}
    <div class="row bold"><span>TOTAL</span><span>Rp ${Number(r.total).toLocaleString('id-ID')}</span></div>
    <div class="line"></div>
    <div class="row"><span>Pembayaran</span><span>${r.payment_method} (${r.payment_provider})</span></div>
    <div class="row"><span>Provider</span><span>${r.provider || '-'}</span></div>
    ${r.sn ? `<div class="sn"><strong>SN / Token:</strong><br>${r.sn}</div>` : ''}
    <div class="line"></div>
    <div class="center" style="font-size:11px;color:#666">Terima kasih atas transaksi Anda<br>Simpan struk ini sebagai bukti</div>
  </div>
  <div class="center no-print" style="margin-top:16px">
    <button onclick="window.print()" style="padding:10px 24px;font-size:14px;cursor:pointer;background:#0d6efd;color:#fff;border:none;border-radius:6px">Cetak Struk</button>
  </div>
</body>
</html>`;
}

// ========== SALES REPORT ==========
app.get('/api/admin/reports/sales', checkAdmin, (req, res) => {
  const { from, to, group_by } = req.query;
  let transactions = readJSON('transactions.json');

  if (from) {
    const fromDate = new Date(from);
    transactions = transactions.filter(t => new Date(t.created_at) >= fromDate);
  }
  if (to) {
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    transactions = transactions.filter(t => new Date(t.created_at) <= toDate);
  }

  const successTx = transactions.filter(t => t.status === 'success');
  const failedTx = transactions.filter(t => t.status === 'failed');

  const summary = {
    total_transactions: transactions.length,
    success_count: successTx.length,
    failed_count: failedTx.length,
    success_rate: transactions.length ? Math.round((successTx.length / transactions.length) * 100) : 0,
    total_revenue: successTx.reduce((s, t) => s + (t.total || 0), 0),
    total_product_amount: successTx.reduce((s, t) => s + (t.amount || 0), 0),
    total_fee: successTx.reduce((s, t) => s + (t.fee || 0), 0),
    refunded_count: transactions.filter(t => t.refunded).length
  };

  let grouped = {};
  const gb = group_by || 'day';

  transactions.forEach(t => {
    let key;
    if (gb === 'month') key = t.created_at.slice(0, 7);
    else if (gb === 'product') key = t.product_name || t.product_id;
    else if (gb === 'provider') key = t.provider_ppob || 'unknown';
    else key = t.created_at.slice(0, 10);

    if (!grouped[key]) {
      grouped[key] = { key, count: 0, success: 0, failed: 0, revenue: 0, fee: 0 };
    }
    grouped[key].count++;
    if (t.status === 'success') {
      grouped[key].success++;
      grouped[key].revenue += t.total || 0;
      grouped[key].fee += t.fee || 0;
    } else {
      grouped[key].failed++;
    }
  });

  const groups = Object.values(grouped).sort((a, b) => {
    if (gb === 'day' || gb === 'month') return a.key.localeCompare(b.key);
    return b.revenue - a.revenue;
  });

  res.json({
    success: true,
    data: { period: { from: from || null, to: to || null }, summary, groups, group_by: gb }
  });
});

// ========== CALLBACKS ==========

// ========== Webhook / Callback Payment & PPOB ==========
function appendWebhookLog(entry) {
  try {
    const list = readJSON('webhook_logs.json');
    const arr = Array.isArray(list) ? list : [];
    arr.unshift({ id: 'wh-' + Date.now(), at: new Date().toISOString(), ...entry });
    writeJSON('webhook_logs.json', arr.slice(0, 500));
  } catch (e) { console.warn('webhook log', e.message); }
}

function verifyWebhookSignature(provider, req, conf) {
  const secret = conf?.webhook_secret || conf?.callback_token || conf?.server_key || conf?.shared_key || conf?.api_key || '';
  if (!secret || !conf?.webhook_verify) return { ok: true, reason: 'verify-disabled' };
  const sig =
    req.headers['x-callback-token'] ||
    req.headers['x-bdpay-signature'] ||
    req.headers['x-doku-signature'] ||
    req.headers['x-callback-signature'] ||
    req.headers['x-hub-signature-256'] ||
    (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '') ||
    '';
  // Midtrans: sha512 of order_id+status_code+gross_amount+server_key
  if (provider === 'midtrans') {
    const body = req.body || {};
    const expected = crypto.createHash('sha512')
      .update(String(body.order_id || '') + String(body.status_code || '') + String(body.gross_amount || '') + String(conf.server_key || secret))
      .digest('hex');
    const ok = !body.signature_key || body.signature_key === expected;
    return { ok, reason: ok ? 'midtrans-sig-ok' : 'midtrans-sig-fail' };
  }
  if (!sig) return { ok: false, reason: 'missing-signature' };
  // Generic HMAC compare
  const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  const h = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const ok = sig === h || sig === secret || sig === ('sha256=' + h);
  return { ok, reason: ok ? 'hmac-ok' : 'hmac-fail' };
}

function handlePaymentWebhook(provider, req, res) {
  const settings = getSettings();
  const conf = (settings.api_payment && settings.api_payment[provider]) || {};
  if (conf.webhook_active === false) {
    appendWebhookLog({ provider, event: 'rejected', reason: 'webhook_inactive', body: req.body });
    return res.status(403).json({ success: false, message: 'Webhook nonaktif untuk ' + provider });
  }
  const ver = verifyWebhookSignature(provider, req, conf);
  if (!ver.ok) {
    appendWebhookLog({ provider, event: 'rejected', reason: ver.reason, body: req.body });
    return res.status(401).json({ success: false, message: 'Signature invalid', reason: ver.reason });
  }
  const body = req.body || {};
  const va =
    body.va_number || body.virtual_account || body.va ||
    body.virtualAccount || body.paymentCode ||
    body.account_number || body.callback_virtual_account_id ||
    (body.va_numbers && body.va_numbers[0] && body.va_numbers[0].va_number) ||
    null;
  const orderId = body.order_id || body.orderNum || body.order_no || body.external_id || body.invoice_number || body.merchant_order_id || null;
  const statusRaw = String(body.transaction_status || body.status || body.payment_status || body.platRespCode || '').toLowerCase();
  const paid =
    ['settlement', 'capture', 'success', 'paid', 'completed', 'sukses'].includes(statusRaw) ||
    body.paid === true ||
    statusRaw === 'success' ||
    // Midtrans capture/settlement
    (provider === 'midtrans' && (statusRaw === 'settlement' || statusRaw === 'capture')) ||
    // default: if VA present and no explicit fail, treat as paid when status empty (sandbox sim)
    (va && !statusRaw);

  appendWebhookLog({
    provider, event: 'received', va, order_id: orderId, status: statusRaw || (paid ? 'paid' : 'unknown'),
    verified: ver.reason, paid: !!paid, body
  });

  if (va && paid) markTransferPaidByVA(va, provider, body);
  if (orderId) {
    const isSuccess = paid || statusRaw === 'success' || statusRaw === 'settlement';
    const isFail = ['deny', 'cancel', 'expire', 'failure', 'failed'].includes(statusRaw);
    updateTransactionFromCallback(orderId, isFail ? 'failed' : (isSuccess ? 'success' : null), null, provider, body);
  }
  // Real-time push log for admin polling
  try {
    const live = readJSON('webhook_live.json') || [];
    const arr = Array.isArray(live) ? live : [];
    arr.unshift({ at: new Date().toISOString(), provider, va, order_id: orderId, paid: !!paid, status: statusRaw });
    writeJSON('webhook_live.json', arr.slice(0, 50));
  } catch (_) {}

  res.json({ success: true, message: 'Webhook processed', provider, paid: !!paid });
}

app.post('/api/callback/digiflazz', (req, res) => {
  appendWebhookLog({ provider: 'digiflazz', event: 'ppob', body: req.body });
  const ref = req.body?.data?.ref_id || req.body?.ref_id;
  const st = String(req.body?.data?.status || req.body?.status || '').toLowerCase();
  if (ref) updateTransactionFromCallback(ref, st === 'sukses' || st === 'success' ? 'success' : 'failed', req.body?.data?.sn, 'digiflazz', req.body);
  res.json({ data: 1 });
});

app.post('/api/callback/bdpay', (req, res) => handlePaymentWebhook('bdpay', req, res));
app.post('/api/callback/doku', (req, res) => handlePaymentWebhook('doku', req, res));
app.post('/api/callback/xendit', (req, res) => handlePaymentWebhook('xendit', req, res));
app.post('/api/callback/midtrans', (req, res) => handlePaymentWebhook('midtrans', req, res));

// Generic webhook by provider name
app.post('/api/webhook/:provider', (req, res) => {
  const p = String(req.params.provider || '').toLowerCase();
  if (['bdpay', 'midtrans', 'doku', 'xendit'].includes(p)) return handlePaymentWebhook(p, req, res);
  if (['digiflazz', 'iak', 'raja-biller', 'raja_biller'].includes(p)) {
    appendWebhookLog({ provider: p, event: 'ppob', body: req.body });
    return res.json({ success: true });
  }
  res.status(404).json({ success: false, message: 'Unknown provider' });
});

app.get('/api/admin/webhooks/logs', checkAdmin, (req, res) => {
  res.json({ success: true, data: readJSON('webhook_logs.json') || [] });
});

app.post('/api/admin/webhooks/test', checkAdmin, (req, res) => {
  try {
    const { provider, va_number, order_id, status } = req.body || {};
    const p = String(provider || 'bdpay').toLowerCase();
    const va = String(va_number || '').trim();
    const oid = String(order_id || '').trim();
    if (!va && !oid) {
      return res.status(400).json({ success: false, message: 'VA Number atau Order ID wajib diisi' });
    }
    // Langsung tandai paid (sandbox test) — lebih andal dari nested res mock
    let paidTransfer = null;
    if (va) {
      paidTransfer = markTransferPaidByVA(va, p, { source: 'admin_webhook_test', order_id: oid });
    }
    if (!paidTransfer && oid) {
      const list = readJSON('transfers.json');
      const arr = Array.isArray(list) ? list : [];
      const t = arr.find(x => x.order_no === oid || x.va_number === oid);
      if (t) {
        t.status = 'paid';
        t.paid_at = new Date().toISOString();
        t.callback_received = true;
        t.payment_verified = true;
        t.paid_via = p + '_webhook_test';
        writeJSON('transfers.json', arr);
        paidTransfer = t;
      }
    }
    if (oid) {
      updateTransactionFromCallback(oid, 'success', null, p, { test: true });
    }
    appendWebhookLog({
      provider: p, event: 'admin_test', va, order_id: oid,
      status: 'paid', paid: !!paidTransfer, body: req.body
    });
    if (!paidTransfer && !oid) {
      return res.json({
        success: true,
        paid: false,
        message: 'Webhook dicatat, tetapi VA tidak ditemukan di Transfer Order. Pastikan nomor VA benar.'
      });
    }
    res.json({
      success: true,
      paid: true,
      message: paidTransfer
        ? ('VA/Order ditandai paid: ' + (paidTransfer.order_no || va))
        : 'Webhook test diproses',
      data: paidTransfer || null
    });
  } catch (e) {
    console.error('[webhook test]', e);
    res.status(500).json({ success: false, message: e.message });
  }
});


app.post('/api/callback/iak', (req, res) => {
  const body = req.body;
  console.log('[CALLBACK IAK]', JSON.stringify(body).slice(0, 300));
  const refId = body.ref_id || body.data?.ref_id;
  const status = body.status || body.data?.status;
  const isSuccess = status == 1 || status === 'success' || status === 'SUCCESS';
  const sn = body.sn || body.data?.sn;
  updateTransactionFromCallback(refId, isSuccess ? 'success' : 'failed', sn, 'iak', body);
  res.json({ success: true });
});

app.get('/api/user/:id/transactions', (req, res) => {
  const transactions = readJSON('transactions.json');
  const userTx = transactions.filter(t => t.user_id === req.params.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ success: true, data: userTx });
});

// ========== ADMIN ==========
app.post('/api/admin/login', (req, res) => {
  // Admin login tanpa captcha; Google Authenticator (TOTP) jika sudah diaktifkan
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const totp = String(req.body?.totp || req.body?.otp || '').trim();
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password wajib diisi' });
  }
  let settings;
  try {
    settings = getSettings();
  } catch (e) {
    console.error('[admin/login] getSettings', e.message);
    return res.status(500).json({ success: false, message: 'Gagal membaca pengaturan admin' });
  }
  const adminUser = (settings.admin && settings.admin.username) || 'admin';
  const adminPass = (settings.admin && settings.admin.password) || 'admin123';
  if (username !== adminUser || password !== adminPass) {
    return res.status(401).json({ success: false, message: 'Login gagal — username atau password salah' });
  }
  const totpCfg = (settings.admin && settings.admin.totp) || {};
  if (totpCfg.enabled && totpCfg.secret) {
    if (!totp) {
      return res.status(401).json({ success: false, message: 'Kode Google Authenticator wajib', require_totp: true });
    }
    if (!verifyTotp(totpCfg.secret, totp)) {
      return res.status(401).json({ success: false, message: 'Kode Authenticator salah', require_totp: true });
    }
  }
  const token = signJwt({ sub: adminUser, role: 'admin' }, { expiresIn: 60 * 60 * 12 });
  const needPairing = !totpCfg.enabled || !totpCfg.secret || !!totpCfg.require_pairing;
  return res.json({
    success: true,
    message: 'Login berhasil',
    data: {
      token,
      token_type: 'Bearer',
      expires_in: 60 * 60 * 12,
      username: adminUser,
      totp_enabled: !!(totpCfg.enabled && totpCfg.secret),
      need_totp_pairing: needPairing
    },
    // backward-compatible flat fields
    token,
    username: adminUser,
    totp_enabled: !!(totpCfg.enabled && totpCfg.secret),
    need_totp_pairing: needPairing
  });
});

/** Meta API — health, rate limit info, architecture markers */
app.get('/api/health', (req, res) => {
  Api.ok(res, {
    status: 'ok',
    service: 'bdPay',
    time: new Date().toISOString(),
    jwt: true,
    pool: true
  }, 'OK');
});
app.get('/api/meta', (req, res) => {
  Api.ok(res, {
    json_format: { success: 'boolean', message: 'string?', data: 'any?', error: 'object?', meta: 'object?' },
    auth: { admin: 'Bearer JWT atau X-Admin-Auth', merchant: 'X-Merchant-Auth JWT', user: 'body user_id + opsional X-User-Auth JWT' },
    http_status: [200, 201, 400, 401, 403, 404, 429, 500, 503],
    rate_limit: 'per IP; auth endpoints lebih ketat',
    https: 'force_https & HSTS via settings.https (CMS & SEO)'
  }, 'API meta');
});


app.get('/api/admin/totp/status', checkAdmin, (req, res) => {
  const t = (getSettings().admin && getSettings().admin.totp) || {};
  res.json({
    success: true,
    data: {
      enabled: !!t.enabled,
      require_pairing: !!(t.require_pairing || !t.enabled),
      has_secret: !!(t.secret || t.pending_secret),
      hard_reset_configured: !!t.hard_reset_code_hash
    }
  });
});

app.post('/api/admin/totp/setup', checkAdmin, async (req, res) => {
  try {
    const st = getSettings();
    st.admin = st.admin || {};
    const secret = generateTotpSecret();
    // Hard reset code: 16 char alphanumeric (shown once at setup/confirm)
    const hardReset = crypto.randomBytes(10).toString('hex').toUpperCase().slice(0, 16);
    st.admin.totp = {
      secret,
      enabled: false,
      require_pairing: true,
      pending_secret: secret,
      hard_reset_code_hash: require('crypto').createHash('sha256').update(hardReset).digest('hex'),
      hard_reset_code_plain_once: hardReset, // only until confirm response; stripped after
      created_at: new Date().toISOString()
    };
    writeSettings(st);
    const user = (st.admin.username || 'admin');
    const url = totpOtpauthURL(secret, user, 'bdPay Admin');
    let qr_data_url = null;
    try {
      qr_data_url = await makeQrDataUrl(url);
    } catch (e) {
      console.warn('[totp] QR generate', e.message);
    }
    res.json({
      success: true,
      message: 'Scan QR di Google Authenticator, lalu konfirmasi kode 6 digit. Simpan Kode Hard Reset.',
      data: {
        secret,
        otpauth_url: url,
        qr_data_url,
        hard_reset_code: hardReset
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || 'Gagal setup TOTP' });
  }
});

app.post('/api/admin/totp/confirm', checkAdmin, (req, res) => {
  const code = String(req.body?.totp || req.body?.otp || '').trim();
  const st = getSettings();
  st.admin = st.admin || {};
  const prev = st.admin.totp || {};
  const pending = prev.pending_secret || prev.secret || '';
  if (!pending) return res.status(400).json({ success: false, message: 'Jalankan setup TOTP dulu' });
  if (!verifyTotp(pending, code)) return res.status(400).json({ success: false, message: 'Kode tidak valid' });
  const hardPlain = prev.hard_reset_code_plain_once || null;
  st.admin.totp = {
    secret: pending,
    enabled: true,
    require_pairing: false,
    hard_reset_code_hash: prev.hard_reset_code_hash || null,
    confirmed_at: new Date().toISOString()
  };
  writeSettings(st);
  res.json({
    success: true,
    message: 'Google Authenticator aktif',
    data: {
      enabled: true,
      hard_reset_code: hardPlain,
      note: hardPlain ? 'Simpan Kode Hard Reset ini. Tidak ditampilkan lagi.' : undefined
    }
  });
});

/** Hard Reset TOTP — nonaktifkan Authenticator dengan kode hard reset */
app.post('/api/admin/totp/hard-reset', checkAdmin, (req, res) => {
  const code = String(req.body?.hard_reset_code || req.body?.code || '').trim().toUpperCase().replace(/\s/g, '');
  if (!code || code.length < 8) {
    return res.status(400).json({ success: false, message: 'Kode Hard Reset wajib' });
  }
  const st = getSettings();
  st.admin = st.admin || {};
  const t = st.admin.totp || {};
  const hash = t.hard_reset_code_hash;
  if (!hash) {
    return res.status(400).json({ success: false, message: 'Belum ada Kode Hard Reset. Generate Secret dulu.' });
  }
  const check = require('crypto').createHash('sha256').update(code).digest('hex');
  if (check !== hash) {
    return res.status(401).json({ success: false, message: 'Kode Hard Reset salah' });
  }
  st.admin.totp = {
    enabled: false,
    require_pairing: true,
    secret: null,
    pending_secret: null,
    hard_reset_code_hash: null,
    reset_at: new Date().toISOString()
  };
  writeSettings(st);
  try {
    pushAudit(auditEntry({
      action: 'totp_hard_reset',
      actor: (st.admin && st.admin.username) || 'admin',
      ip: req.ip,
      level: 'warn',
      detail: 'Google Authenticator dinonaktifkan via Hard Reset'
    }));
  } catch (_) {}
  res.json({
    success: true,
    message: 'Authenticator di-reset. Generate Secret & pairing ulang.',
    data: { enabled: false, require_pairing: true }
  });
});

/** Regenerate hard reset code (requires current TOTP code) */
app.post('/api/admin/totp/regenerate-hard-reset', checkAdmin, (req, res) => {
  const totp = String(req.body?.totp || '').trim();
  const st = getSettings();
  st.admin = st.admin || {};
  const t = st.admin.totp || {};
  if (!t.enabled || !t.secret) {
    return res.status(400).json({ success: false, message: 'Authenticator belum aktif' });
  }
  if (!verifyTotp(t.secret, totp)) {
    return res.status(401).json({ success: false, message: 'Kode Authenticator salah' });
  }
  const hardReset = crypto.randomBytes(10).toString('hex').toUpperCase().slice(0, 16);
  t.hard_reset_code_hash = require('crypto').createHash('sha256').update(hardReset).digest('hex');
  st.admin.totp = t;
  writeSettings(st);
  res.json({
    success: true,
    message: 'Kode Hard Reset baru dibuat — simpan sekarang',
    data: { hard_reset_code: hardReset }
  });
});


app.get('/api/admin/request-logs', checkAdmin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  res.json({ success: true, data: listRequestLogs(limit), meta: { limit } });
});
app.delete('/api/admin/request-logs', checkAdmin, (req, res) => {
  clearRequestLogs();
  res.json({ success: true, message: 'Request logs dikosongkan' });
});
app.put('/api/admin/request-log-settings', checkAdmin, (req, res) => {
  const st = getSettings();
  const b = req.body || {};
  st.request_log = {
    enabled: b.enabled !== false,
    console: b.console !== false,
    persist: b.persist !== false,
    updated_at: new Date().toISOString()
  };
  writeSettings(st);
  res.json({ success: true, data: st.request_log, message: 'Request log settings disimpan' });
});
app.get('/api/admin/request-log-settings', checkAdmin, (req, res) => {
  const st = getSettings();
  const d = st.request_log || { enabled: true, console: true, persist: true };
  res.json({ success: true, data: d });
});

app.get('/api/admin/maintenance', checkAdmin, (req, res) => {
  const m = (getSettings().maintenance) || {};
  res.json({ success: true, data: { enabled: !!m.enabled, message: m.message || '', updated_at: m.updated_at || null } });
});

app.put('/api/admin/maintenance', checkAdmin, (req, res) => {
  const st = getSettings();
  st.maintenance = {
    enabled: !!req.body?.enabled,
    message: String(req.body?.message || 'Sistem dalam maintenance').slice(0, 500),
    updated_at: new Date().toISOString()
  };
  writeSettings(st);
  res.json({ success: true, data: st.maintenance, message: st.maintenance.enabled ? 'Maintenance ON — user & merchant diblokir' : 'Maintenance OFF' });
});

app.get('/api/admin/omnichannel', checkAdmin, (req, res) => {
  const o = getSettings().omnichannel || {};
  res.json({
    success: true,
    data: {
      webhook_url: o.webhook_url || '',
      webhook_secret: o.webhook_secret || '',
      enabled: o.enabled !== false,
      channels: o.channels || {
        pwa: true, merchant: true, whatsapp: false, telegram: false,
        chrome: false, electron: false, php: false
      },
      live_test_url: o.live_test_url || ''
    }
  });
});

app.put('/api/admin/omnichannel', checkAdmin, (req, res) => {
  const st = getSettings();
  const b = req.body || {};
  st.omnichannel = {
    enabled: b.enabled !== false,
    webhook_url: String(b.webhook_url || '').trim(),
    webhook_secret: String(b.webhook_secret || '').trim(),
    channels: b.channels || st.omnichannel?.channels || {},
    live_test_url: String(b.live_test_url || '').trim(),
    updated_at: new Date().toISOString()
  };
  writeSettings(st);
  res.json({ success: true, data: st.omnichannel });
});

app.post('/api/admin/omnichannel/webhook-test', checkAdmin, async (req, res) => {
  const o = getSettings().omnichannel || {};
  const url = String(req.body?.url || o.webhook_url || '').trim();
  if (!url) return res.status(400).json({ success: false, message: 'webhook_url kosong' });
  const payload = {
    event: 'omnichannel.test',
    at: new Date().toISOString(),
    source: 'bdpay-admin',
    sample: { order: 'TEST-ORDER', status: 'paid' }
  };
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-bdPay-Secret': o.webhook_secret || '',
        'X-bdPay-Event': 'omnichannel.test'
      },
      body: JSON.stringify(payload)
    });
    const text = await r.text();
    appendWebhookLog({ provider: 'omnichannel', event: 'test', status: r.status, body: text.slice(0, 500) });
    res.json({ success: r.ok, message: 'HTTP ' + r.status, data: { status: r.status, body: text.slice(0, 300) } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/landing-promo', (req, res) => {
  const p = getSettings().landing_promo || {};
  res.json({ success: true, data: {
    hero_title: p.hero_title || 'bdPay PWA — Portofolio Digital',
    hero_subtitle: p.hero_subtitle || 'PPOB, Transfer Request, Merchant UMKM, Open API. Personal Website Application & Self-service.',
    merchant_banner: p.merchant_banner || 'Daftar Open API merchant, kelola transfer & penagihan pelanggan Anda. Skala Mikro, Kecil, dan Menengah.',
    show_price_compare: p.show_price_compare !== false,
    show_feature_cloud: p.show_feature_cloud !== false
  }});
});

app.get('/api/admin/landing-promo', checkAdmin, (req, res) => {
  const p = getSettings().landing_promo || {};
  res.json({
    success: true,
    data: {
      hero_title: p.hero_title || 'bdPay PWA — Portofolio Digital',
      hero_subtitle: p.hero_subtitle || 'PPOB, Transfer Request, Merchant UMKM, Open API. Personal Website Application & Self-service.',
      merchant_banner: p.merchant_banner || 'Daftar Open API merchant, kelola transfer & penagihan pelanggan Anda. Skala Mikro, Kecil, dan Menengah.',
      show_price_compare: p.show_price_compare !== false,
      show_feature_cloud: p.show_feature_cloud !== false
    }
  });
});

app.put('/api/admin/landing-promo', checkAdmin, (req, res) => {
  const st = getSettings();
  const b = req.body || {};
  st.landing_promo = {
    hero_title: String(b.hero_title || '').slice(0, 200),
    hero_subtitle: String(b.hero_subtitle || '').slice(0, 500),
    merchant_banner: String(b.merchant_banner || '').slice(0, 500),
    show_price_compare: b.show_price_compare !== false,
    show_feature_cloud: b.show_feature_cloud !== false,
    updated_at: new Date().toISOString()
  };
  writeSettings(st);
  res.json({ success: true, data: st.landing_promo });
});

app.post('/api/admin/cleanup-demo', checkAdmin, (req, res) => {
  const newUser = String(req.body?.username || '').trim();
  const newPass = String(req.body?.password || '');
  if (newUser.length < 3 || newPass.length < 6) {
    return res.status(400).json({ success: false, message: 'Username min 3 & password min 6 karakter' });
  }
  // Hapus demo users & demo products
  let users = readJSON('users.json') || [];
  users = (Array.isArray(users) ? users : []).filter(u => {
    const em = String(u.email || '').toLowerCase();
    return !em.includes('demo') && !u.is_demo;
  });
  writeJSON('users.json', users);

  let products = readJSON('products.json') || [];
  products = (Array.isArray(products) ? products : []).filter(p => !p.is_demo && !String(p.id || '').includes('demo'));
  writeJSON('products.json', products);

  let merchants = readMerchants();
  merchants = merchants.filter(m => {
    const em = String(m.email || '').toLowerCase();
    return !em.includes('demo') && !m.is_demo;
  });
  writeMerchants(merchants);

  const st = getSettings();
  st.admin = st.admin || {};
  st.admin.username = newUser;
  st.admin.password = newPass;
  const secret = generateTotpSecret();
  st.admin.totp = {
    secret,
    pending_secret: secret,
    enabled: false,
    require_pairing: true,
    created_at: new Date().toISOString()
  };
  writeSettings(st);
  const url = totpOtpauthURL(secret, newUser, 'bdPay Admin');
  res.json({
    success: true,
    message: 'Demo dibersihkan. Admin baru disimpan. Pairing Google Authenticator wajib.',
    data: {
      username: newUser,
      totp_secret: secret,
      otpauth_url: url,
      need_totp_pairing: true,
      removed: { note: 'user/product/merchant bertanda demo dihapus' }
    }
  });
});


app.get('/api/admin/products', checkAdmin, (req, res) => {
  res.json({ success: true, data: readJSON('products.json') });
});


app.get('/api/admin/products/from-provider', checkAdmin, async (req, res) => {
  const provider = String(req.query.provider || 'digiflazz').toLowerCase();
  const conf = getSettings().api_ppob?.[provider] || getSettings().api_ppob?.[provider.replace('-', '_')] || {};
  // Attempt live price-list when credentials exist; else sandbox catalog
  const catalogs = {
    digiflazz: [
      { name: 'Pulsa Telkomsel 5.000', sku: 'TSEL5', category: 'prabayar', provider_api: 'digiflazz', provider: 'Digiflazz', price: 5500 },
      { name: 'Pulsa Telkomsel 10.000', sku: 'TSEL10', category: 'prabayar', provider_api: 'digiflazz', provider: 'Digiflazz', price: 10500 },
      { name: 'Pulsa Telkomsel 20.000', sku: 'TSEL20', category: 'prabayar', provider_api: 'digiflazz', provider: 'Digiflazz', price: 20500 },
      { name: 'Token PLN 20.000', sku: 'PLN20', category: 'prabayar', provider_api: 'digiflazz', provider: 'Digiflazz', price: 20500 },
      { name: 'Token PLN 50.000', sku: 'PLN50', category: 'prabayar', provider_api: 'digiflazz', provider: 'Digiflazz', price: 50500 },
      { name: 'Data TSEL 3GB', sku: 'TSEL3GB', category: 'prabayar', provider_api: 'digiflazz', provider: 'Digiflazz', price: 32000 }
    ],
    iak: [
      { name: 'Pulsa XL 5.000', sku: 'XL5', category: 'prabayar', provider_api: 'iak', provider: 'IAK', price: 5500 },
      { name: 'Pulsa XL 10.000', sku: 'XL10', category: 'prabayar', provider_api: 'iak', provider: 'IAK', price: 10500 },
      { name: 'Data XL 2GB', sku: 'XL2GB', category: 'prabayar', provider_api: 'iak', provider: 'IAK', price: 25000 },
      { name: 'Data XL 5GB', sku: 'XL5GB', category: 'prabayar', provider_api: 'iak', provider: 'IAK', price: 45000 },
      { name: 'Pulsa ISAT 25.000', sku: 'ISAT25', category: 'prabayar', provider_api: 'iak', provider: 'IAK', price: 25500 }
    ],
    'raja-biller': [
      { name: 'Pulsa ISAT 10.000', sku: 'ISAT10', category: 'prabayar', provider_api: 'raja-biller', provider: 'Raja-Biller', price: 10500 },
      { name: 'Pulsa ISAT 25.000', sku: 'ISAT25', category: 'prabayar', provider_api: 'raja-biller', provider: 'Raja-Biller', price: 25500 },
      { name: 'Tagihan PDAM', sku: 'PDAM', category: 'pascabayar', provider_api: 'raja-biller', provider: 'Raja-Biller', price: 0 },
      { name: 'Tagihan BPJS', sku: 'BPJS', category: 'pascabayar', provider_api: 'raja-biller', provider: 'Raja-Biller', price: 0 },
      { name: 'Pulsa Smartfren 20.000', sku: 'SMART20', category: 'prabayar', provider_api: 'raja-biller', provider: 'Raja-Biller', price: 20500 }
    ]
  };
  let data = catalogs[provider] || catalogs.digiflazz;
  let source = 'sandbox-catalog';
  // Live digiflazz price-list (optional)
  if (provider === 'digiflazz' && conf.username && conf.api_key && conf.mode !== 'demo') {
    try {
      const crypto = require('crypto');
      const sign = crypto.createHash('md5').update(conf.username + conf.api_key + 'pricelist').digest('hex');
      const url = (conf.base_url || 'https://api.digiflazz.com/v1').replace(/\/$/, '') + '/price-list';
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'prepaid', username: conf.username, sign }) });
      const j = await r.json();
      const arr = j.data || j;
      if (Array.isArray(arr) && arr.length) {
        data = arr.slice(0, 200).map((x, i) => ({
          name: x.product_name || x.desc || x.buyer_sku_code || ('SKU ' + i),
          sku: x.buyer_sku_code || x.sku || ('DF' + i),
          category: /pasc|tagihan|post/i.test(String(x.category || x.type || '')) ? 'pascabayar' : 'prabayar',
          provider_api: 'digiflazz',
          provider: 'Digiflazz',
          price: Number(x.price || x.buyer_price || 0)
        }));
        source = 'live-api';
      }
    } catch (e) {
      source = 'sandbox-catalog-fallback';
    }
  }
  // Live / sandbox Raja-Biller price-list
  if ((provider === 'raja-biller' || provider === 'raja_biller') && conf.api_key) {
    try {
      const base = (conf.base_url || conf.baseUrl || 'https://api.raja-biller.com').replace(/\/$/, '');
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + conf.api_key,
        'X-Api-Key': conf.api_key,
        'X-Username': conf.username || ''
      };
      let arr = null;
      for (const path of ['/product', '/products', '/v1/product', '/pricelist']) {
        try {
          const r = await fetch(base + path, { method: 'GET', headers });
          const j = await r.json().catch(() => ({}));
          const cand = j.data || j.products || j.result || j;
          if (Array.isArray(cand) && cand.length) { arr = cand; break; }
        } catch (_) {}
      }
      if (Array.isArray(arr) && arr.length) {
        data = arr.slice(0, 300).map((x, i) => ({
          name: x.product_name || x.name || x.desc || x.product || ('SKU ' + i),
          sku: x.product_code || x.buyer_sku_code || x.sku || x.code || ('RB' + i),
          category: /pasc|tagihan|post/i.test(String(x.category || x.type || x.product_type || '')) ? 'pascabayar' : 'prabayar',
          provider_api: 'raja-biller',
          provider: 'Raja-Biller',
          price: Number(x.price || x.buyer_price || x.sell_price || 0)
        }));
        source = (conf.mode === 'production') ? 'live-api' : 'sandbox-api';
      } else {
        source = 'sandbox-catalog';
      }
    } catch (e) {
      source = 'sandbox-catalog-fallback';
    }
  }
  // IAK sandbox/live pricelist attempt
  if (provider === 'iak' && conf.api_key && conf.username) {
    try {
      const crypto = require('crypto');
      const sign = crypto.createHash('md5').update(conf.username + conf.api_key + 'pricelist').digest('hex');
      const base = (conf.base_url_prepaid || conf.baseUrlPrepaid || (conf.mode === 'production' ? 'https://prepaid.iak.id' : 'https://prepaid.iak.id')).replace(/\/$/, '');
      const r = await fetch(base + '/api/pricelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 1, username: conf.username, sign })
      });
      const j = await r.json();
      const arr = (j.data && (j.data.pricelist || j.data)) || j.pricelist || [];
      if (Array.isArray(arr) && arr.length) {
        data = arr.slice(0, 300).map((x, i) => ({
          name: x.product_description || x.product_name || x.product_code || ('IAK ' + i),
          sku: x.product_code || x.code || ('IAK' + i),
          category: /pasc|post/i.test(String(x.product_type || '')) ? 'pascabayar' : 'prabayar',
          provider_api: 'iak',
          provider: 'IAK',
          price: Number(x.product_price || x.price || 0)
        }));
        source = 'sandbox-api';
      }
    } catch (_) {}
  }
  res.json({ success: true, data, provider, source, stage: conf.mode || 'sandbox' });
});


app.post('/api/admin/products/activate-from-provider', checkAdmin, (req, res) => {
  const products = readJSON('products.json') || [];
  const items = Array.isArray(req.body?.items) ? req.body.items : (req.body?.item ? [req.body.item] : []);
  if (!items.length) return res.status(400).json({ success: false, message: 'Tidak ada produk dipilih' });
  const added = [];
  const updated = [];
  items.forEach((it) => {
    const sku = String(it.sku || '').trim();
    if (!sku) return;
    const existing = products.find(p => String(p.sku).toLowerCase() === sku.toLowerCase() && String(p.provider_api || p.provider || '').toLowerCase() === String(it.provider_api || it.provider || '').toLowerCase());
    if (existing) {
      existing.active = true;
      existing.name = it.name || existing.name;
      existing.price = Number(it.price != null ? it.price : existing.price) || 0;
      existing.category = it.category || existing.category || 'prabayar';
      existing.provider = it.provider || existing.provider;
      existing.provider_api = it.provider_api || existing.provider_api;
      existing.source = 'provider-api';
      updated.push(existing);
    } else {
      const np = {
        id: 'prod-' + require('crypto').randomUUID().slice(0, 8),
        name: it.name || sku,
        sku,
        category: it.category || 'prabayar',
        provider: it.provider || it.provider_api || '',
        provider_api: it.provider_api || it.provider || '',
        price: Number(it.price) || 0,
        active: true,
        source: 'provider-api',
        created_at: new Date().toISOString()
      };
      products.push(np);
      added.push(np);
    }
  });
  writeJSON('products.json', products);
  res.json({ success: true, message: `Aktifkan ${added.length} baru, update ${updated.length}`, data: { added, updated } });
});

app.post('/api/admin/products', checkAdmin, (req, res) => {
  const products = readJSON('products.json');
  const newProd = { id: 'prod-' + uuidv4().slice(0, 8), ...req.body, active: req.body.active !== false };
  products.push(newProd);
  writeJSON('products.json', products);
  res.json({ success: true, data: newProd });
});

app.put('/api/admin/products/:id', checkAdmin, (req, res) => {
  const products = readJSON('products.json');
  const idx = products.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Not found' });
  products[idx] = { ...products[idx], ...req.body };
  writeJSON('products.json', products);
  res.json({ success: true, data: products[idx] });
});

app.delete('/api/admin/products/:id', checkAdmin, (req, res) => {
  let products = readJSON('products.json');
  products = products.filter(p => p.id !== req.params.id);
  writeJSON('products.json', products);
  res.json({ success: true });
});

app.get('/api/admin/faqs', checkAdmin, (req, res) => {
  res.json({ success: true, data: readJSON('faqs.json') });
});

app.post('/api/admin/faqs', checkAdmin, (req, res) => {
  const faqs = readJSON('faqs.json');
  const newFaq = { id: 'faq-' + uuidv4().slice(0, 8), ...req.body, active: true };
  faqs.push(newFaq);
  writeJSON('faqs.json', faqs);
  res.json({ success: true, data: newFaq });
});

app.put('/api/admin/faqs/:id', checkAdmin, (req, res) => {
  const faqs = readJSON('faqs.json');
  const idx = faqs.findIndex(f => f.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false });
  faqs[idx] = { ...faqs[idx], ...req.body };
  writeJSON('faqs.json', faqs);
  res.json({ success: true, data: faqs[idx] });
});

app.delete('/api/admin/faqs/:id', checkAdmin, (req, res) => {
  let faqs = readJSON('faqs.json');
  faqs = faqs.filter(f => f.id !== req.params.id);
  writeJSON('faqs.json', faqs);
  res.json({ success: true });
});

app.get('/api/admin/settings', checkAdmin, (req, res) => {
  res.json({ success: true, data: getSettings() });
});


app.put('/api/admin/settings', checkAdmin, (req, res) => {
  const current = getSettings();
  const updated = { ...current, ...req.body };
  writeJSON('settings.json', updated);
  res.json({ success: true, data: updated });
});

/* —— Databases / i18n / SMTP / SMS / AI CRUD (nested settings) —— */
app.get('/api/admin/databases', checkAdmin, (req, res) => {
  res.json({ success: true, data: getSettings().databases, feature_map_defaults: DEFAULT_FEATURE_MAP });
});
app.put('/api/admin/databases', checkAdmin, (req, res) => {
  const s = getSettings();
  s.databases = { ...s.databases, ...(req.body || {}) };
  if (req.body?.feature_map) s.databases.feature_map = { ...DEFAULT_FEATURE_MAP, ...req.body.feature_map };
  writeSettings(s);
  res.json({ success: true, data: s.databases, message: 'Database setting disimpan' });
});
app.post('/api/admin/databases/test', checkAdmin, async (req, res) => {
  const s = getSettings();
  const kind = String(req.body?.kind || '');
  try {
    if (kind === 'mongodb') {
      const db = await require('./lib/db_adapters').getMongo({ databases: { mongodb: { ...s.databases.mongodb, enabled: true, ...(req.body || {}) } } });
      return res.json({ success: !!db, message: db ? 'MongoDB terhubung' : 'Gagal koneksi MongoDB (cek URI / driver)' });
    }
    if (kind === 'supabase') {
      const ok = await require('./lib/db_adapters').dbGetAll({ databases: { ...s.databases, supabase: { ...s.databases.supabase, enabled: true, ...(req.body || {}) } } }, 'transaksi_laporan', 'health');
      return res.json({ success: true, message: 'Supabase request dicoba (pastikan tabel ada)', data: ok });
    }
    if (kind === 'lowdb') {
      const { lowdbWrite, lowdbRead } = require('./lib/db_adapters');
      lowdbWrite('_ping', [{ ok: true, at: new Date().toISOString() }]);
      return res.json({ success: true, message: 'Lowdb OK', data: lowdbRead('_ping') });
    }
    return res.json({ success: true, message: 'JSON Store selalu aktif (default)' });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

app.get('/api/admin/i18n', checkAdmin, (req, res) => {
  const s = getSettings();
  res.json({ success: true, data: s.i18n });
});
app.put('/api/admin/i18n', checkAdmin, (req, res) => {
  const s = getSettings();
  s.i18n = s.i18n || {};
  if (req.body?.default_lang) s.i18n.default_lang = req.body.default_lang;
  if (req.body?.enabled != null) s.i18n.enabled = !!req.body.enabled;
  if (req.body?.dict) s.i18n.dict = mergeI18n(req.body.dict);
  writeSettings(s);
  res.json({ success: true, data: s.i18n, message: 'Terjemahan disimpan' });
});
app.get('/api/i18n/:lang', (req, res) => {
  const s = getSettings();
  const lang = ['id', 'en', 'cn'].includes(req.params.lang) ? req.params.lang : (s.i18n?.default_lang || 'id');
  res.json({ success: true, lang, data: (s.i18n?.dict || mergeI18n(null))[lang] });
});

app.get('/api/admin/smtp', checkAdmin, (req, res) => {
  const smtp = { ...getSettings().smtp };
  if (smtp.pass) smtp.pass = smtp.pass ? '********' : '';
  res.json({ success: true, data: smtp });
});
app.put('/api/admin/smtp', checkAdmin, (req, res) => {
  const s = getSettings();
  const body = req.body || {};
  s.smtp = { ...s.smtp, ...body };
  if (body.pass === '********') s.smtp.pass = getSettings().smtp?.pass || '';
  writeSettings(s);
  res.json({ success: true, message: 'SMTP disimpan', data: { ...s.smtp, pass: s.smtp.pass ? '********' : '' } });
});
app.post('/api/admin/smtp/test', checkAdmin, async (req, res) => {
  const s = getSettings();
  const to = req.body?.to || s.smtp?.user;
  if (!s.smtp?.enabled) return res.json({ success: false, message: 'SMTP nonaktif — aktifkan dulu' });
  if (!s.smtp.host) return res.json({ success: true, simulation: true, message: 'Simulasi email OK ke ' + to + ' (host kosong)' });
  try {
    // optional nodemailer
    let nodemailer;
    try { nodemailer = require('nodemailer'); } catch (_) {}
    if (!nodemailer) {
      return res.json({ success: true, simulation: true, message: 'nodemailer belum terpasang — simulasi kirim ke ' + to });
    }
    const transporter = nodemailer.createTransport({
      host: s.smtp.host, port: Number(s.smtp.port) || 587, secure: !!s.smtp.secure,
      auth: s.smtp.user ? { user: s.smtp.user, pass: s.smtp.pass } : undefined
    });
    await transporter.sendMail({
      from: s.smtp.from || s.smtp.user,
      to,
      subject: 'bdPay SMTP Test',
      text: 'Email uji dari bdPay Admin ' + new Date().toISOString()
    });
    res.json({ success: true, message: 'Email uji terkirim ke ' + to });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

app.get('/api/admin/sms-gateway', checkAdmin, (req, res) => {
  const sms = { ...getSettings().sms_gateway };
  if (sms.api_secret) sms.api_secret = '********';
  res.json({ success: true, data: sms });
});
app.put('/api/admin/sms-gateway', checkAdmin, (req, res) => {
  const s = getSettings();
  const body = req.body || {};
  s.sms_gateway = { ...s.sms_gateway, ...body };
  if (body.api_secret === '********') s.sms_gateway.api_secret = getSettings().sms_gateway?.api_secret || '';
  writeSettings(s);
  res.json({ success: true, message: 'SMS Gateway disimpan', data: { ...s.sms_gateway, api_secret: s.sms_gateway.api_secret ? '********' : '' } });
});

app.get('/api/admin/ai', checkAdmin, (req, res) => {
  const ai = JSON.parse(JSON.stringify(getSettings().ai || {}));
  ['openai', 'grok', 'gemini', 'groq', 'google_ai_studio', 'deepseek', 'qwen', 'other'].forEach(k => {
    if (ai.providers?.[k]?.api_key) ai.providers[k].api_key = '********';
  });
  res.json({ success: true, data: ai });
});
app.put('/api/admin/ai', checkAdmin, (req, res) => {
  const s = getSettings();
  const body = req.body || {};
  s.ai = { ...s.ai, ...body };
  if (body.providers) {
    s.ai.providers = s.ai.providers || {};
    for (const k of Object.keys(body.providers)) {
      const prev = s.ai.providers[k] || {};
      const next = { ...prev, ...body.providers[k] };
      if (next.api_key === '********') next.api_key = prev.api_key || '';
      s.ai.providers[k] = next;
    }
  }
  writeSettings(s);
  res.json({ success: true, message: 'AI setting disimpan' });
});
app.post('/api/admin/ai/run', checkAdmin, async (req, res) => {
  const { task, prompt, system } = req.body || {};
  const r = await runAI(getSettings(), task || 'general', prompt || '', system || '');
  res.json(r);
});
app.post('/api/admin/ai/cyber', checkAdmin, async (req, res) => {
  const s = getSettings();
  const event = req.body || {};
  const r = await aiCyberAction(s, event);
  const auto = req.body?.auto_apply !== false; // default apply
  const ip = String(event.ip || event.ip_address || '').trim();
  let action = null;
  if (r.success && r.text) {
    try {
      const json = JSON.parse(String(r.text).replace(/```json|```/g, '').trim());
      action = String(json.action || json.recommendation || '').toLowerCase();
      r.parsed = json;
    } catch (_) {
      const t = String(r.text).toLowerCase();
      if (t.includes('blacklist') || t.includes('block')) action = 'blacklist';
      else if (t.includes('whitelist')) action = 'whitelist';
    }
  }
  // Demo/test: always record IP when provided
  if (auto && ip) {
    const lists = readJSON('ip_lists.json') || { whitelist: [], blacklist: [] };
    if (!Array.isArray(lists.blacklist)) lists.blacklist = [];
    if (!Array.isArray(lists.whitelist)) lists.whitelist = [];
    if (action === 'block_ip' || action === 'blacklist' || action === 'block') {
      if (!lists.blacklist.includes(ip)) lists.blacklist.push(ip);
      lists.whitelist = lists.whitelist.filter(x => x !== ip);
      writeJSON('ip_lists.json', lists);
      r.applied = { blacklist: ip, list_size: lists.blacklist.length };
    } else if (action === 'whitelist' || action === 'allow') {
      if (!lists.whitelist.includes(ip)) lists.whitelist.push(ip);
      lists.blacklist = lists.blacklist.filter(x => x !== ip);
      writeJSON('ip_lists.json', lists);
      r.applied = { whitelist: ip, list_size: lists.whitelist.length };
    } else if (req.body?.force_blacklist) {
      if (!lists.blacklist.includes(ip)) lists.blacklist.push(ip);
      writeJSON('ip_lists.json', lists);
      r.applied = { blacklist: ip };
    }
  }
  res.json(r);
});

app.get('/api/admin/ai/activity', checkAdmin, (req, res) => {
  const limit = Math.min(500, Number(req.query.limit) || 100);
  res.json({ success: true, data: listAIActivity(limit) });
});

app.get('/api/banks', (req, res) => {
  const s = getSettings();
  const preferred = (s.preferred_banks?.codes || ['bni', 'permata']).map(c => String(c).toLowerCase());
  const all = [
    { code: 'bni', name: 'BNI' },
    { code: 'permata', name: 'Permata' },
    { code: 'bca', name: 'BCA' },
    { code: 'bri', name: 'BRI' },
    { code: 'mandiri', name: 'Mandiri' },
    { code: 'cimb', name: 'CIMB Niaga' },
    { code: 'btn', name: 'BTN' },
    { code: 'danamon', name: 'Danamon' }
  ];
  const prefSet = new Set(preferred);
  const ordered = [
    ...all.filter(b => prefSet.has(b.code)).map(b => ({ ...b, preferred: true })),
    ...all.filter(b => !prefSet.has(b.code)).map(b => ({ ...b, preferred: false }))
  ];
  res.json({ success: true, data: ordered, preferred_codes: preferred });
});

app.get('/api/admin/preferred-banks', checkAdmin, (req, res) => {
  res.json({ success: true, data: getSettings().preferred_banks });
});
app.put('/api/admin/preferred-banks', checkAdmin, (req, res) => {
  const st = getSettings();
  st.preferred_banks = { ...st.preferred_banks, ...(req.body || {}) };
  if (Array.isArray(req.body?.codes)) st.preferred_banks.codes = req.body.codes.map(c => String(c).toLowerCase());
  writeSettings(st);
  res.json({ success: true, data: st.preferred_banks, message: 'Preferred banks disimpan' });
});

/* Remittance sandbox */
app.post('/api/remittance/quote', async (req, res) => {
  const st = getSettings();
  const provider = String(req.body?.provider || 'ria').toLowerCase();
  const conf = st.api_remittance?.[provider] || { mode: 'sandbox' };
  const r = await executeRemittance(provider, conf, { ...req.body, action: 'quote' });
  res.json({ success: !!r.success, data: r });
});
app.post('/api/remittance/send', async (req, res) => {
  const st = getSettings();
  const provider = String(req.body?.provider || 'ria').toLowerCase();
  const conf = st.api_remittance?.[provider] || { mode: 'sandbox' };
  const r = await executeRemittance(provider, conf, { ...req.body, action: 'send' });
  // log minimal
  try {
    const list = readJSON('merchant_transactions.json') || [];
    if (!Array.isArray(list)) {}
    else {
      list.push({
        id: 'rmt-' + Date.now(), type: 'remittance', provider, status: r.status || 'pending',
        amount: req.body?.amount, created_at: new Date().toISOString(), raw: r
      });
      writeJSON('merchant_transactions.json', list);
    }
  } catch (_) {}
  res.json({ success: !!r.success, data: r, message: r.message });
});


app.get('/api/admin/api-monitor', checkAdmin, (req, res) => {
  try {
    res.json({ success: true, data: readApiMonitor() });
  } catch (e) {
    res.json({ success: true, data: { last_run: null, channels: [], summary: {} } });
  }
});
app.post('/api/admin/api-monitor/run', checkAdmin, async (req, res) => {
  try {
    const data = await runApiMonitor(getSettings());
    res.json({ success: true, message: 'Monitoring selesai', data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || 'Gagal monitoring' });
  }
});

app.get('/api/public/service-stage', (req, res) => {
  const st = getSettings();
  const stage = st.service_stage || {};
  let monitor = { last_run: null, summary: null };
  try { monitor = readApiMonitor() || monitor; } catch (_) {}
  res.json({
    success: true,
    data: {
      overall: stage.overall || 'sandbox',
      ppob: stage.ppob || (st.api_ppob?.digiflazz?.mode || 'sandbox'),
      payment: stage.payment || (st.api_payment?.bdpay?.mode || 'sandbox'),
      remittance: stage.remittance || (st.api_remittance?.mode || 'sandbox'),
      ai: stage.ai || 'production',
      last_monitor: monitor.last_run,
      monitor_summary: monitor.summary || null
    }
  });
});
app.put('/api/admin/service-stage', checkAdmin, (req, res) => {
  const st = getSettings();
  st.service_stage = { ...(st.service_stage || {}), ...(req.body || {}) };
  writeSettings(st);
  res.json({ success: true, data: st.service_stage });
});

/* Merchant remittance */
app.post('/api/merchant/remittance/quote', requireMerchant, async (req, res) => {
  const st = getSettings();
  const provider = String(req.body?.provider || 'ria').toLowerCase();
  const conf = st.api_remittance?.[provider] || { mode: 'sandbox' };
  const amountIdr = Number(req.body?.amount_idr || req.body?.amount || 0);
  if (amountIdr < 10000) return res.status(400).json({ success: false, message: 'Minimal Rp 10.000' });
  const limitUsd = Number((req.merchant.remittance_limits || {})[provider] || conf.default_limit_usd || 10000);
  const approxUsd = amountIdr / 16200;
  if (approxUsd > limitUsd) {
    return res.status(400).json({ success: false, message: 'Melebihi limit ' + provider + ' (max ~USD ' + limitUsd + ')' });
  }
  const r = await executeRemittance(provider, conf, {
    action: 'quote',
    amount: amountIdr,
    source_currency: 'IDR',
    dest_currency: req.body?.dest_currency || 'USD',
    dest_country: req.body?.dest_country || 'US'
  });
  res.json({ success: true, data: { ...r, limit_usd: limitUsd, amount_idr: amountIdr } });
});
app.post('/api/merchant/remittance/create', requireMerchant, async (req, res) => {
  const st = getSettings();
  const provider = String(req.body?.provider || 'ria').toLowerCase();
  const conf = st.api_remittance?.[provider] || { mode: 'sandbox' };
  const amountIdr = Number(req.body?.amount_idr || req.body?.amount || 0);
  const limitUsd = Number((req.merchant.remittance_limits || {})[provider] || conf.default_limit_usd || 10000);
  if (amountIdr / 16200 > limitUsd) {
    return res.status(400).json({ success: false, message: 'Melebihi limit provider' });
  }
  const quote = await executeRemittance(provider, conf, {
    action: 'send',
    amount: amountIdr,
    source_currency: 'IDR',
    dest_currency: req.body?.dest_currency || 'USD',
    dest_country: req.body?.dest_country || 'US',
    beneficiary_name: req.body?.beneficiary_name
  });
  const va = '8818' + String(Date.now()).slice(-10);
  const order = {
    id: 'rmt-' + Date.now(),
    type: 'remittance',
    merchant_id: req.merchant.id,
    trade_name: req.merchant.trade_name,
    provider,
    amount_idr: amountIdr,
    dest_country: req.body?.dest_country || 'US',
    dest_currency: req.body?.dest_currency || 'USD',
    beneficiary_name: req.body?.beneficiary_name || '',
    quote,
    va_number: va,
    va_bank: req.body?.va_bank || 'bni',
    status: 'pending_payment',
    created_at: new Date().toISOString()
  };
  const list = readJSON('merchant_transactions.json') || [];
  const arr = Array.isArray(list) ? list : [];
  arr.unshift(order);
  writeJSON('merchant_transactions.json', arr);
  res.json({ success: true, message: 'VA Remittance diterbitkan. Bayar untuk proses transfer.', data: order });
});
app.get('/api/merchant/remittance', requireMerchant, (req, res) => {
  const list = (readJSON('merchant_transactions.json') || []).filter(t => t.type === 'remittance' && t.merchant_id === req.merchant.id);
  res.json({ success: true, data: list });
});
app.post('/api/merchant/remittance/:id/status', requireMerchant, (req, res) => {
  const list = readJSON('merchant_transactions.json') || [];
  const i = list.findIndex(t => t.id === req.params.id && t.merchant_id === req.merchant.id);
  if (i < 0) return res.status(404).json({ success: false, message: 'Tidak ditemukan' });
  if (req.body?.simulate_paid && list[i].status === 'pending_payment') {
    list[i].status = 'processing';
    list[i].paid_at = new Date().toISOString();
  }
  writeJSON('merchant_transactions.json', list);
  res.json({ success: true, data: list[i] });
});


app.get('/api/admin/remittance', checkAdmin, (req, res) => {
  res.json({ success: true, data: getSettings().api_remittance });
});
app.put('/api/admin/remittance', checkAdmin, (req, res) => {
  const st = getSettings();
  st.api_remittance = { ...st.api_remittance, ...(req.body || {}) };
  writeSettings(st);
  res.json({ success: true, data: st.api_remittance, message: 'Remittance setting disimpan' });
});

/* Merchant Invoice Payment — VA 1 day */
function readInvoices() {
  try {
    const list = readJSON('merchant_invoices.json');
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}
function writeInvoices(arr) {
  try {
    writeJSON('merchant_invoices.json', Array.isArray(arr) ? arr : []);
  } catch (e) {
    console.error('writeInvoices', e.message);
  }
}
function expireInvoices() {
  const list = readInvoices();
  const now = Date.now();
  let changed = false;
  for (const inv of list) {
    if (inv.status === 'pending' && inv.expires_at && new Date(inv.expires_at).getTime() < now) {
      inv.status = 'expired';
      changed = true;
    }
  }
  if (changed) writeInvoices(list);
  return list;
}

app.post('/api/merchant/invoices', requireMerchant, async (req, res) => {
  const b = req.body || {};
  if (!b.customer_name) return res.status(400).json({ success: false, message: 'Nama pelanggan wajib' });
  let items = Array.isArray(b.items) ? b.items.slice(0, 10) : [];
  items = items.map((it, i) => {
    const qtyType = String(it.qty_type || it.quantity_type || 'unit').toLowerCase() === 'ls' ? 'ls' : 'unit';
    const qty = qtyType === 'ls' ? 1 : Math.max(1, Number(it.qty || it.quantity) || 1);
    const unit = Number(it.unit_price || it.price || 0);
    const line = qtyType === 'ls' ? unit : unit * qty;
    return {
      no: i + 1,
      name: String(it.name || it.description || ('Item ' + (i + 1))).slice(0, 200),
      qty_type: qtyType,
      qty,
      unit_price: unit,
      line_total: line
    };
  }).filter(it => it.unit_price > 0 || it.name);
  if (!items.length && Number(b.amount) > 0) {
    items = [{ no: 1, name: b.description || 'Item', qty_type: 'ls', qty: 1, unit_price: Number(b.amount), line_total: Number(b.amount) }];
  }
  if (!items.length) return res.status(400).json({ success: false, message: 'Minimal 1 baris produk/jasa' });
  const amount = items.reduce((a, it) => a + Number(it.line_total || 0), 0);
  const total_qty = items.reduce((a, it) => a + (it.qty_type === 'ls' ? 1 : Number(it.qty || 0)), 0);
  if (amount < 1000) return res.status(400).json({ success: false, message: 'Total minimal Rp 1.000' });
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const invNo = 'INV-' + Date.now().toString().slice(-10);
  const va = '8808' + String(Date.now()).slice(-10);
  const inv = {
    id: 'inv-' + Date.now(),
    invoice_no: invNo,
    merchant_id: req.merchant.id,
    trade_name: req.merchant.trade_name,
    customer_name: b.customer_name,
    customer_email: b.customer_email || '',
    customer_phone: b.customer_phone || '',
    description: b.description || 'Invoice pembayaran',
    items,
    total_qty,
    amount,
    va_number: va,
    va_bank: b.va_bank || 'bni',
    status: 'pending',
    created_at: new Date().toISOString(),
    expires_at: expires.toISOString(),
    paid_at: null
  };
  const list = expireInvoices();
  list.unshift(inv);
  writeInvoices(list);
  res.json({
    success: true,
    message: 'Invoice diterbitkan. VA berlaku 1 hari.',
    data: inv
  });
});
app.get('/api/merchant/invoices', requireMerchant, (req, res) => {
  const list = expireInvoices().filter(i => i.merchant_id === req.merchant.id);
  res.json({ success: true, data: list });
});
app.get('/api/merchant/invoices/:id', requireMerchant, (req, res) => {
  expireInvoices();
  const inv = readInvoices().find(i => i.id === req.params.id && i.merchant_id === req.merchant.id);
  if (!inv) return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan' });
  res.json({ success: true, data: inv });
});
app.post('/api/merchant/invoices/:id/check', requireMerchant, (req, res) => {
  expireInvoices();
  const list = readInvoices();
  const i = list.findIndex(x => x.id === req.params.id && x.merchant_id === req.merchant.id);
  if (i < 0) return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan' });
  // sandbox: optional mark paid via body
  if (req.body?.simulate_paid && list[i].status === 'pending') {
    list[i].status = 'paid';
    list[i].paid_at = new Date().toISOString();
    writeInvoices(list);
  }
  res.json({ success: true, data: list[i], message: 'Status: ' + list[i].status });
});

app.get('/api/admin/audible', checkAdmin, (req, res) => {
  res.json({ success: true, data: getSettings().audible });
});
app.put('/api/admin/audible', checkAdmin, (req, res) => {
  const s = getSettings();
  s.audible = { ...s.audible, ...(req.body || {}) };
  writeSettings(s);
  res.json({ success: true, data: s.audible, message: 'Audible setting disimpan' });
});

app.get('/api/public/audible', (req, res) => {
  const a = getSettings().audible || {};
  res.json({ success: true, data: a });
});
app.post('/api/ai/assist', async (req, res) => {
  const s = getSettings();
  if (s.audible?.ai_assistance === false && s.ai?.tasks?.assistance === false) {
    return res.status(403).json({ success: false, message: 'AI Assistance nonaktif' });
  }
  const { task, prompt, context } = req.body || {};
  const system = 'Anda asisten bdPay untuk pengguna/merchant. Bahasa sesuai pengguna. Ringkas dan ramah. Bantu aksesibilitas dan panduan transaksi.';
  const r = await runAI(s, task || 'assistance', (prompt || '') + (context ? '\nContext: ' + JSON.stringify(context).slice(0, 1000) : ''), system);
  res.json(r);
});


app.get('/api/admin/cms', checkAdmin, (req, res) => {
  res.json({ success: true, data: readJSON('cms.json') });
});

app.put('/api/admin/cms', checkAdmin, (req, res) => {
  const body = req.body || {};
  const cms = readJSON('cms.json') || {};
  if (body.hero) {
    cms.pages = cms.pages || {};
    cms.pages.home = cms.pages.home || {};
    if (body.hero.title != null) cms.pages.home.hero_title = body.hero.title;
    if (body.hero.subtitle != null) cms.pages.home.hero_subtitle = body.hero.subtitle;
    cms.hero = body.hero;
  }
  if (body.contact) cms.contact = { ...(cms.contact || {}), ...body.contact };
  if (body.seo) cms.seo = { ...(cms.seo || {}), ...body.seo };
  writeJSON('cms.json', cms);
  const settings = getSettings();
  if (body.site) {
    settings.site = { ...(settings.site || {}), ...body.site };
  }
  if (body.seo) settings.seo = { ...(settings.seo || {}), ...body.seo };
  if (body.hero) settings.hero = body.hero;
  if (body.contact) settings.contact = { ...(settings.contact || {}), ...body.contact };
  writeSettings(settings);
  res.json({ success: true, message: 'CMS disimpan', data: cms });
});

app.get('/api/admin/transactions', checkAdmin, (req, res) => {
  const all = readJSON('transactions.json');
  const arr = Array.isArray(all) ? all : [];
  // Hanya PPOB — exclude Transfer VA / Vendor / Saldo / Disbursement
  const data = arr.filter(t => {
    const typ = String(t.type || '').toLowerCase();
    const ref = String(t.ref_id || t.order_no || '');
    if (typ === 'domestic_transfer' || typ === 'saldo_topup' || typ === 'vendor_pay' || typ === 'transfer_va' || typ === 'disbursement') return false;
    if (ref.startsWith('MTR-') || ref.startsWith('MTP-') || ref.startsWith('MVA-') || ref.startsWith('MDS-')) return false;
    // default: punya product_name / product_id / type ppob / MPP / TRX
    if (typ === 'ppob' || ref.startsWith('MPP-') || ref.startsWith('TRX-') || t.product_id || t.product_name) return true;
    // rows tanpa type tapi dari personal PPOB (legacy)
    if (!typ && !t.va_number) return true;
    return false;
  });
  res.json({ success: true, data });
});

app.post('/api/admin/refund/:id', checkAdmin, (req, res) => {
  const transactions = readJSON('transactions.json');
  const idx = transactions.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false });
  if (transactions[idx].status !== 'failed' || transactions[idx].refunded) {
    return res.status(400).json({ success: false, message: 'Tidak bisa refund' });
  }
  transactions[idx].refunded = true;
  transactions[idx].refund_status = 'completed';
  transactions[idx].refunded_at = new Date().toISOString();
  writeJSON('transactions.json', transactions);
  res.json({ success: true, message: 'Refund diproses (simulasi ke rekening pengguna)', data: transactions[idx] });
});


app.put('/api/admin/users/:id/status', checkAdmin, (req, res) => {
  const st = req.body?.status;
  if (!['active', 'on_hold'].includes(st)) return res.status(400).json({ success: false, message: 'status: active|on_hold' });
  const users = readJSON('users.json');
  const i = users.findIndex(u => u.id === req.params.id);
  if (i < 0) return res.status(404).json({ success: false, message: 'Not found' });
  users[i].status = st;
  writeJSON('users.json', users);
  pushAudit(auditEntry({ action: 'user_status', actor: 'admin', ip: req.ip, detail: { id: users[i].id, status: st } }));
  res.json({ success: true, message: 'Status user: ' + st, data: { id: users[i].id, status: st } });
});

app.get('/api/admin/users', checkAdmin, (req, res) => {
  const users = readJSON('users.json');
  res.json({
    success: true,
    data: users.map(u => ({
      id: u.id,
      email: u.email,
      username: u.username,
      status: u.status || 'active',
      has_ktp: !!(u.ktp_image),
      created_at: u.created_at,
      bank_account: u.bank_account,
      bank_name: u.bank_name,
      email_verified: !!u.email_verified,
      kyc_status: u.kyc_status || 'pending',
      profile_completed: !!u.profile_completed,
      tnc_accepted: !!u.tnc_accepted,
      agreement_accepted: !!u.agreement_accepted,
      profile: u.profile || {},
      phone: u.phone || u.profile?.phone,
      has_ktp: !!u.ktp_image,
      ktp_uploaded_at: u.ktp_uploaded_at || null
    }))
  });
});

// Kartu profil + KTP per user (admin)
app.get('/api/admin/users/:id/card', checkAdmin, (req, res) => {
  const users = readJSON('users.json');
  const u = users.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
  res.json({
    success: true,
    data: {
      id: u.id,
      username: u.username,
      email: u.email,
      email_verified: !!u.email_verified,
      kyc_status: u.kyc_status,
      profile_completed: !!u.profile_completed,
      tnc_accepted: !!u.tnc_accepted,
      agreement_accepted: !!u.agreement_accepted,
      profile: u.profile || {},
      phone: u.phone || u.profile?.phone,
      bank_account: u.bank_account,
      bank_name: u.bank_name,
      account_holder: u.account_holder,
      ktp_image: u.ktp_image || null,
      ktp_processed: u.ktp_processed || null,
      ktp_filename: u.ktp_filename || null,
      ktp_uploaded_at: u.ktp_uploaded_at || null,
      kyc_data: u.kyc_data || null,
      created_at: u.created_at
    }
  });
});

// Admin: Fees CRUD (items array in settings)
app.get('/api/admin/fees', checkAdmin, (req, res) => {
  const s = getSettings();
  const f = s.fees || {};
  const data = {
    service: f.service || f.ppob || { items: f.items || [] },
    markup: f.markup || { items: [] },
    transfer: f.transfer || f.domestic || {
      items: [
        { name: 'Biaya Admin', type: 'fixed', value: 500, active: true },
        { name: 'Biaya Layanan', type: 'percent', value: 1, active: true }
      ]
    },
    ppob: f.service || f.ppob || { items: f.items || [] },
    domestic: f.transfer || f.domestic || { items: [] }
  };
  res.json({ success: true, data });
});

app.put('/api/admin/credentials', checkAdmin, (req, res) => {
  const s = getSettings();
  if (!s.admin) s.admin = {};
  if (req.body.username) s.admin.username = String(req.body.username).trim();
  if (req.body.password) s.admin.password = String(req.body.password);
  writeSettings(s);
  pushAudit(auditEntry({ action: 'admin_credentials_update', actor: 'admin', ip: req.ip, detail: { username: s.admin.username } }));
  res.json({ success: true, message: 'Username/password admin diperbarui. Login ulang jika perlu.' });
});

app.put('/api/admin/fees', checkAdmin, (req, res) => {
  const s = getSettings();
  const body = req.body || {};
  s.fees = {
    ...(s.fees || {}),
    service: body.service || body.ppob || s.fees?.service || {},
    markup: body.markup || s.fees?.markup || {},
    transfer: body.transfer || body.domestic || s.fees?.transfer || {},
    ppob: body.service || body.ppob || s.fees?.ppob || {},
    domestic: body.transfer || body.domestic || s.fees?.domestic || {},
    items: (body.service || body.ppob)?.items || s.fees?.items || []
  };
  writeSettings(s);
  res.json({ success: true, message: 'Biaya & markup disimpan', data: s.fees });
});

// Admin: Taxes CRUD
app.get('/api/admin/taxes', checkAdmin, (req, res) => {
  const s = getSettings();
  res.json({ success: true, data: s.taxes || { items: [] } });
});
app.put('/api/admin/taxes', checkAdmin, (req, res) => {
  const current = getSettings();
  current.taxes = { ...current.taxes, ...req.body };
  writeJSON('settings.json', current);
  pushAudit(auditEntry({ action: 'taxes_update', actor: 'admin', ip: req.ip, detail: {} }));
  res.json({ success: true, data: current.taxes });
});

// Admin: Audit log

app.get('/api/admin/merchant-menu', checkAdmin, (req, res) => {
  const s = getSettings();
  const defaults = {
    dashboard: true, profile: true, 'register-flow': true, transfer: true, vendor: true,
    invoice: true, remittance: true, saldo: true, disbursement: true, ppob: true,
    reports: true, audit: true, inbox: true
  };
  res.json({ success: true, data: { ...(defaults), ...(s.merchant_menu_visibility || {}) } });
});
app.put('/api/admin/merchant-menu', checkAdmin, (req, res) => {
  const st = getSettings();
  st.merchant_menu_visibility = { ...(st.merchant_menu_visibility || {}), ...(req.body || {}) };
  writeSettings(st);
  pushAudit(auditEntry({ action: 'merchant_menu_visibility', actor: 'admin', ip: req.ip, detail: st.merchant_menu_visibility }));
  res.json({ success: true, data: st.merchant_menu_visibility, message: 'Visibilitas menu Merchant disimpan' });
});
app.get('/api/public/merchant-menu', (req, res) => {
  const s = getSettings();
  const defaults = {
    dashboard: true, profile: true, 'register-flow': true, transfer: true, vendor: true,
    invoice: true, remittance: true, saldo: true, disbursement: true, ppob: true,
    reports: true, audit: true, inbox: true
  };
  res.json({ success: true, data: { ...defaults, ...(s.merchant_menu_visibility || {}) } });
});

app.get('/api/admin/audit', checkAdmin, (req, res) => {
  const logs = readJSON('audit_log.json');
  let arr = Array.isArray(logs) ? logs.slice() : [];
  // sertakan jejak merchant (action berawalan merchant_ atau actor merchant)
  const scope = String(req.query.scope || 'all');
  if (scope === 'merchant') {
    arr = arr.filter(a => /merchant/i.test(String(a.action || '')) || /merchant/i.test(String(a.actor || '')) || a.source === 'merchant');
  } else if (scope === 'admin') {
    arr = arr.filter(a => !/merchant/i.test(String(a.action || '')) && String(a.actor || '') === 'admin');
  }
  // newest first
  arr.sort((a, b) => Date.parse(b.ts || b.created_at || 0) - Date.parse(a.ts || a.created_at || 0));
  res.json({ success: true, data: arr.slice(0, 500), total: arr.length });
});

// Admin: KYC submissions
app.get('/api/admin/kyc', checkAdmin, (req, res) => {
  const subs = readJSON('kyc_submissions.json');
  res.json({ success: true, data: Array.isArray(subs) ? subs.slice().reverse() : [] });
});


// ========== DOMESTIC TRANSFER REQUEST (bdPay) ==========

// Inquiry nama pemilik rekening (dengan jeda 3 menit)
app.post('/api/bank/inquiry', async (req, res) => {
  const { user_id, bank_code, account_number } = req.body;
  if (!bank_code || !account_number) {
    return res.status(400).json({ success: false, message: 'Bank dan nomor rekening wajib' });
  }
  const key = user_id || req.ip;
  const cd = checkInquiryCooldown(key);
  if (!cd.allowed) {
    return res.status(429).json({ success: false, message: cd.message, retry_after_seconds: cd.retry_after_seconds });
  }
  markInquiry(key);
  const banks = { bca: 'BCA', bri: 'BRI', mandiri: 'MANDIRI', bni: 'BNI', cimb: 'CIMB', permata: 'PERMATA' };
  const bankName = banks[String(bank_code).toLowerCase()] || String(bank_code).toUpperCase();
  const account_name = 'PENERIMA ' + String(account_number).slice(-4);
  res.json({
    success: true,
    data: {
      bank_code: String(bank_code).toLowerCase(),
      bank_name: bankName,
      account_number: String(account_number),
      account_name,
      simulated: true
    }
  });
});

app.post('/api/transfer/inquiry', async (req, res) => {
  const { bank_code, account_number, user_id } = req.body;
  if (!bank_code || !account_number) {
    return res.status(400).json({ success: false, message: 'Bank dan nomor rekening wajib' });
  }
  const cd = checkInquiryCooldown(user_id || req.ip);
  if (!cd.allowed) {
    return res.status(429).json({ success: false, message: cd.message, retry_after_seconds: cd.retry_after_seconds });
  }
  markInquiry(user_id || req.ip);
  // Inquiry via bdPay (simulasi jika key kosong)
  const settings = getSettings();
  const bd = settings.api_payment?.bdpay || {};
  let account_name = '';
  let simulated = true;
  try {
    if (bd.api_key && bd.merchant_code && bd.mode === 'production') {
      // Placeholder real call structure
      const host = bd.base_url || 'https://dev-openapi.bdpay.co.id';
      // Real implementation depends on bdPay inquiry endpoint docs
      simulated = true;
    }
  } catch (e) {}
  // Demo inquiry response
  const banks = { bca: 'BCA', bri: 'BRI', mandiri: 'MANDIRI', bni: 'BNI', cimb: 'CIMB', permata: 'PERMATA' };
  const bankName = banks[String(bank_code).toLowerCase()] || String(bank_code).toUpperCase();
  account_name = 'PENERIMA ' + String(account_number).slice(-4);
  res.json({
    success: true,
    data: {
      bank_code: String(bank_code).toLowerCase(),
      bank_name: bankName,
      account_number: String(account_number),
      account_name,
      simulated
    }
  });
});

app.post('/api/transfer/create', async (req, res) => {
  const { user_id, bank_code, account_number, account_name, amount, va_duration } = req.body;
  if (!user_id || !bank_code || !account_number || !amount) {
    return res.status(400).json({ success: false, message: 'Data transfer tidak lengkap' });
  }
  const users = readJSON('users.json');
  const user = users.find(u => u.id === user_id);
  if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
  if (!user.profile_completed) {
    return res.status(403).json({ success: false, message: 'Lengkapi Profil terlebih dahulu', code: 'PROFILE_INCOMPLETE' });
  }

  const settings = getSettings();
  const baseAmount = Number(amount) || 0;
  // Biaya Domestic Transfer dari settings
  const tf = calcTransferFeesAndTax(baseAmount, settings);
  const feeTotal = tf.fee;
  const taxTotal = tf.tax;
  const fee_lines = tf.feeLines;
  const tax_lines = tf.taxLines;
  const grandTotal = tf.grand; // nominal VA = transfer + biaya + pajak atas biaya

  const limits = settings.transaction_limits || { max_per_transfer: 50000000, max_per_day: 500000000 };
  if (baseAmount > limits.max_per_transfer) {
    return res.status(400).json({ success: false, message: 'Melebihi limit per transfer (maks Rp ' + limits.max_per_transfer.toLocaleString('id-ID') + ')' });
  }
  const transfersToday = (Array.isArray(readJSON('transfers.json')) ? readJSON('transfers.json') : [])
    .filter(x => x.user_id === user_id && String(x.created_at || '').slice(0, 10) === new Date().toISOString().slice(0, 10));
  const daySum = transfersToday.reduce((sum, x) => sum + (Number(x.base_amount || x.amount) || 0), 0);
  if (daySum + baseAmount > limits.max_per_day) {
    return res.status(400).json({ success: false, message: 'Melebihi limit harian (maks Rp ' + limits.max_per_day.toLocaleString('id-ID') + ')' });
  }

  const dur = Number(va_duration) === 60 ? 60 : 5;
  const orderNo = 'TO-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  const vaNumber = '88' + String(Math.floor(Math.random() * 1e10)).padStart(10, '0');
  const expires = new Date(Date.now() + dur * 60 * 1000).toISOString();
  const host = req.protocol + '://' + req.get('host');
  let pay = { provider: 'bdpay', simulated: true, va_number: vaNumber, payment_url: null };
  try {
    const payResult = await executePaymentWithSwitching(settings, {
      orderId: orderNo,
      amount: grandTotal,
      method: 'va',
      name: user.account_holder || user.username,
      email: user.email,
      phone: user.phone || '',
      customer: { name: user.username, email: user.email },
      notifyUrl: host + '/api/callback/bdpay',
      bank: bank_code
    });
    if (payResult && payResult.va_number) pay.va_number = payResult.va_number;
    if (payResult && payResult.provider) pay.provider = payResult.provider;
    if (payResult && payResult.simulated != null) pay.simulated = !!payResult.simulated;
  } catch (e) {
    console.warn('[transfer/create] payment switch', e.message);
  }

  const transfer = {
    order_no: orderNo,
    user_id,
    user_email: user.email,
    user_name: (user.profile && user.profile.nama_ktp) || user.username || '',
    user_nik: (user.profile && user.profile.nik) || '',
    bank_code,
    account_number,
    account_name: account_name || '',
    base_amount: baseAmount,
    fee: feeTotal,
    tax: taxTotal,
    fee_lines,
    tax_lines,
    amount: grandTotal,
    va_number: pay.va_number,
    provider: pay.provider,
    status: 'pending',
    expires_at: expires,
    created_at: new Date().toISOString(),
    paid_at: null,
    simulated: pay.simulated
  };
  const list = readJSON('transfers.json');
  const arr = Array.isArray(list) ? list : [];
  arr.push(transfer);
  writeJSON('transfers.json', arr);
  pushAudit(auditEntry({ action: 'transfer_create', actor: user.email, ip: req.ip, detail: { order_no: orderNo, amount: grandTotal } }));
  res.json({
    success: true,
    message: 'Virtual Account diterbitkan',
    data: {
      order_no: orderNo,
      va_number: transfer.va_number,
      base_amount: baseAmount,
      fee: feeTotal,
      tax: taxTotal,
      fee_lines,
      tax_lines,
      amount: grandTotal,
      expires_at: transfer.expires_at,
      va_duration_minutes: dur,
      bank_code: transfer.bank_code,
      account_number: transfer.account_number,
      account_name: transfer.account_name,
      status: transfer.status,
      provider: transfer.provider
    }
  });
});

app.get('/api/transfer/status/:orderNo', (req, res) => {
  const list = readJSON('transfers.json');
  const arr = Array.isArray(list) ? list : [];
  const t = arr.find(x => x.order_no === req.params.orderNo);
  if (!t) return res.status(404).json({ success: false, message: 'Nomor Transfer Order tidak ditemukan' });
  // Auto-expire
  if (t.status === 'pending' && t.expires_at && new Date(t.expires_at) < new Date()) {
    t.status = 'expired';
    writeJSON('transfers.json', arr);
  }
  res.json({ success: true, data: t });
});

app.post('/api/transfer/status', (req, res) => {
  const order_no = req.body.order_no || req.body.orderNo;
  if (!order_no) return res.status(400).json({ success: false, message: 'Nomor Transfer Order wajib' });
  const list = readJSON('transfers.json');
  const arr = Array.isArray(list) ? list : [];
  const t = arr.find(x => x.order_no === order_no);
  if (!t) return res.status(404).json({ success: false, message: 'Nomor Transfer Order tidak ditemukan' });
  if (t.status === 'pending' && t.expires_at && new Date(t.expires_at) < new Date()) {
    t.status = 'expired';
    writeJSON('transfers.json', arr);
  }
  res.json({ success: true, data: t });
});


function migrateToEncrypted() {
  ENCRYPTED_FILES.forEach(filename => {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (raw.startsWith('ENC:')) return;
    try {
      const data = JSON.parse(raw);
      writeJSON(filename, data);
      console.log(`[SECURITY] Encrypted ${filename}`);
    } catch (e) { /* ignore */ }
  });
}

migrateToEncrypted();



// —— Admin: all transfers ——
app.get('/api/admin/transfers', checkAdmin, (req, res) => {
  let list = readJSON('transfers.json');
  list = Array.isArray(list) ? list : [];
  // Gabungkan merchant VA yang belum termirror
  try {
    const mtx = merchantTxFile().filter(t => t.va_number && (t.type === 'domestic_transfer' || t.type === 'vendor_pay' || t.type === 'saldo_topup'));
    mtx.forEach(t => {
      if (!list.find(x => x.order_no === t.order_no || x.va_number === t.va_number)) {
        list.push({ ...t, source: 'merchant' });
      }
    });
  } catch (_) {}

  const arr = Array.isArray(list) ? list : [];
  const users = readJSON('users.json');
  const merchants = readMerchants();
  const data = arr.slice().reverse().map(tr => {
    const u = users.find(x => x.id === tr.user_id);
    const mcht = tr.merchant_id ? merchants.find(x => x.id === tr.merchant_id) : null;
    return {
      ...tr,
      user_email: u?.email || (mcht ? mcht.trade_name : (tr.trade_name || '')),
      user_label: mcht ? mcht.trade_name : (u?.email || tr.trade_name || '-'),
      source_label: (tr.source === 'merchant' || tr.merchant_id) ? 'bdPay Merchant' : 'bdPay PWA'
    };
  });
  res.json({ success: true, data });
});

// —— Simulasi bayar VA ——
app.post('/api/admin/va/simulate-pay', checkAdmin, (req, res) => {
  const settings = getSettings();
  const simEnabled = settings.va_simulation?.enabled !== false;
  if (req.body?.enabled === false || (!simEnabled && req.body?.force !== true)) {
    return res.status(400).json({ success: false, message: 'Fitur simulasi VA nonaktif di pengaturan.' });
  }
  const { va_number, order_no } = req.body || {};
  const list = readJSON('transfers.json');
  const arr = Array.isArray(list) ? list : [];
  let t = null;
  if (order_no) t = arr.find(x => x.order_no === order_no);
  if (!t && va_number) t = arr.find(x => String(x.va_number) === String(va_number));

  // Cari juga di merchant_transactions
  const mtx = merchantTxFile();
  let mt = null;
  if (order_no) mt = mtx.find(x => x.order_no === order_no);
  if (!mt && va_number) mt = mtx.find(x => String(x.va_number) === String(va_number));

  if (!t && !mt) return res.status(404).json({ success: false, message: 'VA / Transfer Order tidak ditemukan (personal & merchant)' });

  if (t) {
    if (t.status !== 'paid') {
      t.status = 'paid';
      t.paid_at = new Date().toISOString();
      t.paid_via = 'admin_simulation';
      t.payment_verified = true;
      writeJSON('transfers.json', arr);
    }
  }
  if (mt) {
    if (mt.status !== 'paid') {
      mt.status = 'paid';
      mt.paid_at = new Date().toISOString();
      mt.paid_via = 'admin_simulation';
      writeMerchantTx(mtx);
      // Kredit saldo merchant untuk domestic_transfer / saldo_topup
      if (mt.type === 'domestic_transfer' || mt.type === 'saldo_topup' || mt.type === 'payment_va') {
        const merchants = readMerchants();
        const i = merchants.findIndex(x => x.id === mt.merchant_id);
        if (i >= 0) {
          merchants[i].balance = (Number(merchants[i].balance) || 0) + Number(mt.base_amount || mt.amount || 0);
          if (mt.type === 'saldo_topup' && mt.account) {
            merchants[i].accounts = merchants[i].accounts || [];
            if (!merchants[i].accounts.find(a => a.account === mt.account && a.bank === mt.bank)) {
              merchants[i].accounts.push({
                id: 'acc-' + Date.now(), bank: mt.bank, account: mt.account, name: mt.name,
                activated_at: new Date().toISOString()
              });
            }
          }
          writeMerchants(merchants);
        }
      }
    }
    // sync mirror transfer row
    if (t) {
      t.status = 'paid';
      t.paid_at = mt.paid_at;
      writeJSON('transfers.json', arr);
    } else {
      mirrorMerchantTxToTransfers({ ...mt, status: 'paid' }, readMerchants().find(x => x.id === mt.merchant_id));
      const arr2 = readJSON('transfers.json');
      const a2 = Array.isArray(arr2) ? arr2 : [];
      const row = a2.find(x => x.order_no === mt.order_no);
      if (row) { row.status = 'paid'; row.paid_at = mt.paid_at; writeJSON('transfers.json', a2); }
    }
  }
  pushAudit(auditEntry({ action: 'va_simulate_pay', actor: 'admin', ip: req.ip, detail: { va_number, order_no, merchant: !!(mt) } }));
  res.json({
    success: true,
    message: 'VA ditandai paid' + (mt ? ' (Merchant)' : ' (Personal)'),
    data: mt || t
  });
});

// —— Limits CRUD ——
app.get('/api/admin/limits', checkAdmin, (req, res) => {
  const s = getSettings();
  res.json({
    success: true,
    data: s.transaction_limits || {
      max_per_transfer: 50000000,
      max_per_day: 500000000
    }
  });
});

app.put('/api/admin/limits', checkAdmin, (req, res) => {
  const s = getSettings();
  s.transaction_limits = {
    max_per_transfer: Number(req.body.max_per_transfer) || 50000000,
    max_per_day: Number(req.body.max_per_day) || 500000000
  };
  writeSettings(s);
  pushAudit(auditEntry({ action: 'limits_update', actor: 'admin', ip: req.ip, detail: s.transaction_limits }));
  res.json({ success: true, message: 'Limit disimpan', data: s.transaction_limits });
});

app.get('/api/admin/reports/all', checkAdmin, (req, res) => {
  const merchants = readMerchants();
  const findM = (id) => merchants.find(x => x.id === id || ('merchant:' + x.id) === id);
  const personal = (Array.isArray(readJSON('transactions.json')) ? readJSON('transactions.json') : []).map(t => {
    const isM = String(t.user_id || '').startsWith('merchant:') || t.source === 'merchant';
    const mid = isM ? String(t.user_id || '').replace('merchant:', '') || t.merchant_id : null;
    const mcht = mid ? findM(mid) : null;
    return {
      ...t,
      channel: isM ? 'merchant' : 'personal',
      type: t.type || 'ppob',
      pengirim: isM ? (t.trade_name || (mcht && mcht.trade_name) || 'Merchant') : (t.user_name || t.customer_name || 'User'),
      nik_pengirim: isM ? (t.pic_nik || (mcht && mcht.kyc && mcht.kyc.nik) || '') : (t.nik || ''),
      penerima: 'bdPay PWA',
      provider_label: isM
        ? ((t.provider || 'digiflazz') + (String(t.provider || '').includes('bdPay') ? '' : ' / bdPay'))
        : (t.provider || t.payment_provider || 'bdpay'),
      channel_label: isM ? 'bdPay Merchant' : 'bdPay PWA'
    };
  });
  const transfers = (Array.isArray(readJSON('transfers.json')) ? readJSON('transfers.json') : []).map(t => {
    const isM = t.source === 'merchant' || !!t.merchant_id;
    const mcht = t.merchant_id ? findM(t.merchant_id) : null;
    let jenis = 'Transfer VA';
    if (t.type === 'vendor_pay') jenis = 'Vendor Pay';
    else if (t.type === 'saldo_topup') jenis = 'Transfer VA'; // aktivasi saldo = Transfer VA
    else if (t.type === 'ppob') jenis = 'PPOB';
    return {
      ...t,
      channel: isM ? 'merchant' : 'personal',
      type: t.type === 'saldo_topup' ? 'transfer_va' : (t.type || 'transfer_va'),
      jenis,
      pengirim: isM ? (t.trade_name || (mcht && mcht.trade_name) || 'Merchant') : (t.user_email || t.user_name || '-'),
      nik_pengirim: isM ? (t.pic_nik || (mcht && mcht.kyc && mcht.kyc.nik) || '') : (t.nik || ''),
      penerima: isM ? (t.name || 'Rekening Tujuan') : 'bdPay PWA',
      provider_label: isM ? ((t.provider || 'bdpay') + (String(t.provider||'').includes('Merchant')?'':' · Merchant')) : (t.provider || 'bdpay'),
      channel_label: isM ? 'bdPay Merchant' : 'bdPay PWA',
      amount: t.grand_total != null ? t.grand_total : t.amount
    };
  });
  const merchant = merchantTxFile().map(t => {
    const mcht = findM(t.merchant_id);
    let jenis = t.type;
    if (t.type === 'domestic_transfer' || t.type === 'saldo_topup') jenis = 'Transfer VA';
    else if (t.type === 'vendor_pay') jenis = 'Vendor Pay';
    else if (t.type === 'ppob') jenis = 'PPOB';
    return {
      ...t,
      channel: 'merchant',
      jenis,
      pengirim: t.trade_name || (mcht && mcht.trade_name) || 'Merchant',
      nik_pengirim: t.pic_nik || (mcht && mcht.kyc && mcht.kyc.nik) || '',
      penerima: t.type === 'ppob' ? 'bdPay PWA' : (t.name || 'Rekening Tujuan'),
      provider_label: t.type === 'ppob'
        ? (t.provider || 'digiflazz / bdPay')
        : ((t.provider || 'bdpay') + ' · Merchant'),
      channel_label: 'bdPay Merchant',
      amount: t.grand_total != null ? t.grand_total : t.amount
    };
  });
  // Urutan: merchant tx (paling akurat type) → transfers → personal
  const merged = [...merchant, ...transfers, ...personal];
  const seen = new Set();
  const data = [];
  for (const t of merged) {
    const keys = [
      t.va_number ? 'va:' + String(t.va_number) : null,
      (t.order_no || t.ref_id) ? 'ord:' + String(t.order_no || t.ref_id) : null,
      t.id ? 'id:' + String(t.id) : null
    ].filter(Boolean);
    if (keys.some(k => seen.has(k))) continue;
    keys.forEach(k => seen.add(k));
    // Normalisasi jenis final
    let jenis = t.jenis || t.type || '';
    const typ = String(t.type || '').toLowerCase();
    if (typ === 'saldo_topup' || typ === 'domestic_transfer' || typ === 'transfer_va' || String(t.order_no||'').startsWith('MTP-') || String(t.order_no||'').startsWith('MTR-')) {
      jenis = 'Transfer VA';
    } else if (typ === 'vendor_pay' || String(t.order_no||'').startsWith('MVA-')) {
      jenis = 'Vendor Pay';
    } else if (typ === 'ppob' || String(t.order_no||'').startsWith('MPP-') || String(t.ref_id||'').startsWith('TRX-')) {
      jenis = 'PPOB';
    } else if (!jenis || jenis === 'saldo_topup') {
      jenis = t.va_number && !t.product_name ? 'Transfer VA' : (jenis || 'PPOB');
    }
    data.push({ ...t, jenis, type: jenis === 'Transfer VA' ? 'transfer_va' : (jenis === 'Vendor Pay' ? 'vendor_pay' : (jenis === 'PPOB' ? 'ppob' : t.type)) });
  }
  // Sinkron status: jika ada sumber paid untuk VA/order yang sama, pakai paid
  const paidMap = {};
  data.forEach(t => {
    const st = String(t.status || '').toLowerCase();
    if (st === 'paid' || st === 'success') {
      if (t.va_number) paidMap['va:' + t.va_number] = t;
      if (t.order_no) paidMap['ord:' + t.order_no] = t;
      if (t.ref_id) paidMap['ord:' + t.ref_id] = t;
    }
  });
  data.forEach(t => {
    const hit = (t.va_number && paidMap['va:' + t.va_number]) ||
      (t.order_no && paidMap['ord:' + t.order_no]) ||
      (t.ref_id && paidMap['ord:' + t.ref_id]);
    if (hit && String(t.status).toLowerCase() !== 'paid' && String(t.status).toLowerCase() !== 'success') {
      t.status = hit.status;
      t.paid_at = hit.paid_at || t.paid_at;
    }
  });
  data.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  res.json({ success: true, data });
});

app.get('/api/admin/reports/transfers', checkAdmin, (req, res) => {
  const list = readJSON('transfers.json');
  const arr = Array.isArray(list) ? list : [];
  const users = readJSON('users.json');
  const map = {};
  for (const tr of arr) {
    const uid = tr.user_id || 'unknown';
    if (!map[uid]) map[uid] = { user_id: uid, count: 0, total_amount: 0, paid: 0, pending: 0 };
    map[uid].count++;
    map[uid].total_amount += Number(tr.amount) || 0;
    if (tr.status === 'paid') map[uid].paid++;
    if (tr.status === 'pending') map[uid].pending++;
  }
  const data = Object.values(map).map(x => {
    const u = users.find(z => z.id === x.user_id);
    return { ...x, email: u?.email || x.user_id };
  });
  res.json({ success: true, data });
});




// Konfirmasi / simulasi pembayaran order (user)
app.post('/api/order/confirm-payment', async (req, res) => {
  const { ref_id, user_id } = req.body;
  if (!ref_id) return res.status(400).json({ success: false, message: 'ref_id wajib' });
  const transactions = readJSON('transactions.json');
  const arr = Array.isArray(transactions) ? transactions : [];
  const idx = arr.findIndex(x => x.ref_id === ref_id);
  if (idx < 0) return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });
  const tx = arr[idx];
  if (user_id && tx.user_id && tx.user_id !== user_id) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  if (tx.status === 'success') {
    return res.json({ success: true, message: 'Sudah lunas', data: tx });
  }
  tx.status = 'success';
  tx.payment_status = 'paid';
  tx.paid_at = new Date().toISOString();
  tx.callback_received = true;
  tx.paid_via = 'user_simulation';
  arr[idx] = tx;
  writeJSON('transactions.json', arr);
  res.json({
    success: true,
    message: 'Pembayaran berhasil (simulasi). Transaksi sukses.',
    data: {
      ref_id: tx.ref_id,
      status: tx.status,
      sn: tx.sn,
      total: tx.total,
      va_number: tx.va_number,
      qr_string: tx.qr_string
    }
  });
});

// ========== MERCHANT UMKM SELF-SERVICE ==========

// Ketentuan Profil Merchant (validasi kuesioner vs skala)
const MERCHANT_PROFILE_RULES = {
  mikro: {
    karyawan: '0-20',
    harga: '0-50000',
    omset_harian: '0-100000000'
  },
  kecil: {
    karyawan: '20-100',
    harga: '50000-1000000',
    omset_harian: '100000000-450000000'
  },
  menengah: {
    karyawan: '100+',
    harga: '1000000+',
    omset_harian: '450000000+'
  }
};

function normBucket(v) {
  v = String(v || '').trim();
  // alias lama → baru
  if (v === '>100') return '100+';
  if (v === '>1000000') return '1000000+';
  if (v === '>450000000') return '450000000+';
  return v;
}
function matchKaryawanBucket(scale, bucket) {
  bucket = normBucket(bucket);
  const map = { mikro: '0-20', kecil: '20-100', menengah: '100+' };
  return map[scale] === bucket;
}
function matchHargaBucket(scale, bucket) {
  bucket = normBucket(bucket);
  const map = { mikro: '0-50000', kecil: '50000-1000000', menengah: '1000000+' };
  return map[scale] === bucket;
}
function matchOmsetBucket(scale, bucket) {
  bucket = normBucket(bucket);
  const map = { mikro: '0-100000000', kecil: '100000000-450000000', menengah: '450000000+' };
  return map[scale] === bucket;
}

function omsetBulananFromBucket(bucket) {
  bucket = normBucket(bucket);
  if (bucket === '0-100000000') return 50_000_000 * 30;
  if (bucket === '100000000-450000000') return 275_000_000 * 30;
  if (bucket === '450000000+' || bucket === '>450000000') return 500_000_000 * 30;
  return 0;
}


function readMerchants() {
  const list = readJSON('merchants.json');
  return Array.isArray(list) ? list : [];
}
function writeMerchants(arr) { writeJSON('merchants.json', arr); }
function readMessages() {
  const list = readJSON('merchant_messages.json');
  return Array.isArray(list) ? list : [];
}
function writeMessages(arr) { writeJSON('merchant_messages.json', arr); }

function getMerchantFromReq(req) {
  const token = req.headers['x-merchant-auth'] || extractBearer(req) || '';
  if (!token) return null;
  // JWT
  const jwt = verifyJwt(token);
  if (jwt.ok && jwt.payload && jwt.payload.role === 'merchant' && jwt.payload.sub) {
    return readMerchants().find(x => x.id === jwt.payload.sub) || null;
  }
  // Legacy base64 id::email
  try {
    const raw = Buffer.from(token, 'base64').toString('utf8');
    const [id, email] = raw.split('::');
    const m = readMerchants().find(x => x.id === id && x.email === email);
    return m || null;
  } catch { return null; }
}

function checkIpAccess(req) {
  try {
    const lists = readJSON('ip_lists.json') || { whitelist: [], blacklist: [] };
    const ip = String(req.ip || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (!ip) return { ok: true };
    const bl = lists.blacklist || [];
    const wl = lists.whitelist || [];
    if (bl.length && bl.some(x => ip === x || ip.startsWith(x))) return { ok: false, reason: 'IP diblokir (blacklist Admin)' };
    if (wl.length && !wl.some(x => ip === x || ip.startsWith(x))) return { ok: false, reason: 'IP tidak di whitelist Admin' };
    return { ok: true, ip };
  } catch (_) { return { ok: true }; }
}

function requireMerchant(req, res, next) {
  const ipCheck = checkIpAccess(req);
  if (!ipCheck.ok) return res.status(403).json({ success: false, message: ipCheck.reason });
  const m = getMerchantFromReq(req);
  if (!m) return res.status(401).json({ success: false, message: 'Unauthorized merchant' });
  if (m.status === 'on_hold') return res.status(403).json({ success: false, message: 'Akun merchant On-Hold. Hubungi admin.' });
  req.merchant = m;
  next();
}
function merchantToken(m) {
  if (!m) return '';
  return signJwt({ sub: m.id, email: m.email, role: 'merchant', trade_name: m.trade_name || '' }, { expiresIn: 60 * 60 * 24 });
}
function publicMerchant(m) {
  if (!m) return null;
  const { password_hash, pin_hash, ...rest } = m;
  rest.pin_set = !!pin_hash;
  return rest;
}

// Seed demo merchant
(function seedDemoMerchant() {
  let list = readMerchants();
  if (!Array.isArray(list)) list = [];
  const demo = {
    id: 'mch-demo-001',
    pic_name: 'Andri Pribadi (PIC Demo)',
    email: 'merchant@demo.bdpay',
    trade_name: 'Toko Berkah Digital Demo',
    password_hash: hashPassword('demo123'),
    status: 'verified',
    scale: 'mikro',
    balance: 15000000,
    logo: '',
    website: 'https://demo-merchant.bdpay.local',
    phone: '081234567890',
    email_verified: true,
    phone_verified: true,
    registration_steps: {
      email_verified: true, trade_name_ok: true, kyc_done: true, geo_done: true,
      tnc_ok: true, agreement_ok: true, scale_set: true, liveness_ok: true,
      phone_verified: true, kuesioner_ok: true, aml_ok: true
    },
    wizard: {
      stage: 'done', pic_done: true, umkm_done: true,
      pic_saved_at: '2026-08-01T08:00:00.000Z',
      umkm_saved_at: '2026-08-01T08:15:00.000Z',
      completed_at: '2026-08-01T08:30:00.000Z'
    },
    kyc: {
      nik: '3515080807820006',
      nama_ktp: 'ANDRI PRIBADI WIRIASTO, SE',
      verified: true, simulation: true, nik_match: 100, nama_match: 100
    },
    geo: {
      lat: -7.2575, lng: 112.7521,
      kecamatan: 'Gubeng', kota: 'Surabaya', kode_pos: '60281'
    },
    liveness: { passed: true, score: 94, frames: 3, simulation: true, at: '2026-08-01T08:10:00.000Z' },
    kuesioner: {
      karyawan_bucket: '0-20',
      kategori_usaha: 'Eceran',
      jenis_barang_jasa: 'Barang',
      harga_bucket: '0-50000',
      omset_bucket: '0-100000000',
      omset_bulanan: 1500000000,
      omset_bulanan_locked: true,
      scale_at_submit: 'mikro'
    },
    agreements: { aml: true, consumer: true, infosec: true, cyber: true, law: true },
    scale_docs: {},

    accounts: [
      { id: 'acc-demo-bca', bank: 'bca', account: '1234567890', name: 'ANDRI PRIBADI WIRIASTO', activated_at: '2026-08-01T09:00:00.000Z' },
      { id: 'acc-demo-bri', bank: 'bri', account: '0987654321', name: 'TOKO BERKAH DIGITAL DEMO', activated_at: '2026-08-01T09:05:00.000Z' }
    ],
    payment_mode: 'sandbox',
    approved_at: '2026-08-01T08:30:00.000Z',
    created_at: '2026-08-01T07:00:00.000Z'
  };
  demo.pin_hash = hashPin('123456');
  demo.pin_set_at = '2026-08-01T08:00:00.000Z';
  // Pastikan folder media + placeholder demo tersedia
  try {
    const tinyJpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCABkAGQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z', 'base64');
    // generate simple colored PNG placeholders via minimal valid PNG
    function writePlaceholder(slot, label) {
      const dir = path.join(MEDIA_DIR, 'mch-demo-001');
      fs.mkdirSync(dir, { recursive: true });
      const fp = path.join(dir, slot + '.jpg');
      if (!fs.existsSync(fp)) fs.writeFileSync(fp, tinyJpeg);
      return '/media/merchants/mch-demo-001/' + slot + '.jpg';
    }
    demo.liveness = demo.liveness || {};
    demo.liveness.photo = writePlaceholder('liveness', 'Liveness');
    demo.kyc = demo.kyc || {};
    // jangan overwrite ktp jika sudah ada path nyata — seed hanya fallback
    if (!demo.kyc.ktp_image) demo.kyc.ktp_image = writePlaceholder('ktp_pic', 'KTP');
    if (!demo.kyc.ktp_processed) demo.kyc.ktp_processed = writePlaceholder('ktp_pic_processed', 'KTP Proc');
    demo.scale = 'menengah';
    demo.scale_docs = {
      ktp_direksi: { image: writePlaceholder('ktp_direksi', 'KTP Dir'), processed_image: writePlaceholder('ktp_direksi_processed', 'KTP Dir Proc'), verified: true, number: '3515080807820006', nama: 'ANDRI PRIBADI WIRIASTO, SE' },
      npwp_direksi: { image: writePlaceholder('npwp_direksi', 'NPWP'), verified: true, number: '10.0.0.1-012.000' },
      akta_notaris: { image: writePlaceholder('akta_notaris', 'Akta'), verified: true, number: '12' },
      sk_kemenkumham: { image: writePlaceholder('sk_kemenkumham', 'SK'), verified: true, number: 'AHU-0012345.AH.01.01.TAHUN.2024' }
    };
  } catch (e) { console.warn('[seed media]', e.message); }

  const idx = list.findIndex(m => m.email === 'merchant@demo.bdpay' || m.id === 'mch-demo-001');
  if (idx >= 0) {
    const prev = list[idx];
    const bal = Math.max(Number(prev.balance) || 0, demo.balance);
    // JANGAN hapus foto/dokumen yang sudah diupload pengguna
    const mergedKyc = { ...demo.kyc, ...(prev.kyc || {}) };
    if (prev.kyc && prev.kyc.ktp_image) mergedKyc.ktp_image = prev.kyc.ktp_image;
    if (prev.kyc && prev.kyc.ktp_processed) mergedKyc.ktp_processed = prev.kyc.ktp_processed;
    const mergedLive = { ...demo.liveness, ...(prev.liveness || {}) };
    if (prev.liveness && prev.liveness.photo) mergedLive.photo = prev.liveness.photo;
    const mergedDocs = { ...(demo.scale_docs || {}), ...(prev.scale_docs || {}) };
    list[idx] = {
      ...demo,
      ...prev,
      balance: bal,
      password_hash: hashPassword('demo123'),
      pin_hash: hashPin('123456'),
      pin_set_at: prev.pin_set_at || demo.pin_set_at,
      status: prev.status || demo.status,
      kyc: mergedKyc,
      liveness: mergedLive,
      scale_docs: mergedDocs,
      registration_steps: { ...demo.registration_steps, ...(prev.registration_steps || {}) },
      agreements: { ...demo.agreements, ...(prev.agreements || {}) },
      email: 'merchant@demo.bdpay',
      id: 'mch-demo-001',
      trade_name: prev.trade_name || demo.trade_name
    };
  } else {
    list.push(demo);
  }
  writeMerchants(list);
  console.log('[MERCHANT] Demo PIC+UMKM verified: merchant@demo.bdpay / demo123 · PIN 123456');
})();

(function seedDemoMerchantMessages() {
  try {
    let list = [];
    try {
      const raw = require('fs').readFileSync(require('path').join(__dirname, 'data', 'messages.json'), 'utf8');
      list = JSON.parse(raw.startsWith('ENC:') ? '[]' : raw);
      if (!Array.isArray(list)) list = [];
    } catch (_) { list = []; }
    if (list.some(m => m.id === 'msg-demo-1')) return;
    const now = Date.now();
    list.unshift(
      { id: 'msg-demo-1', from: 'admin', to: 'merchant', merchant_id: 'mch-demo-001', direction: 'in', subject: 'Selamat bergabung', body: 'Akun merchant demo sudah Verified. Silakan uji Domestic Transfer dan Disbursement.', unread: true, created_at: new Date(now - 86400000).toISOString() },
      { id: 'msg-demo-2', from: 'merchant', to: 'admin', merchant_id: 'mch-demo-001', direction: 'out', subject: 'Konfirmasi onboarding', body: 'Terima kasih, kami sudah coba aktivasi saldo.', unread: false, created_at: new Date(now - 43200000).toISOString() },
      { id: 'msg-demo-3', from: 'admin', to: 'merchant', merchant_id: 'mch-demo-001', direction: 'in', subject: 'Limit transaksi Mikro', body: 'Limit harian sesuai kategori Mikro. Hubungi admin untuk upgrade.', unread: true, created_at: new Date(now - 3600000).toISOString() }
    );
    require('fs').writeFileSync(require('path').join(__dirname, 'data', 'messages.json'), JSON.stringify(list, null, 2));
  } catch (e) { console.warn('[seed messages]', e.message); }
})();



app.post('/api/merchant/register', (req, res) => {
  const _cap = verifyCaptcha(req.body?.captcha_id, req.body?.captcha_answer);
  if (!_cap.ok) return res.status(400).json({ success: false, message: _cap.message });
  const { pic_name, email, trade_name, password } = req.body || {};
  if (!pic_name || !email || !trade_name || !password) {
    return res.status(400).json({ success: false, message: 'Lengkapi data registrasi' });
  }
  const list = readMerchants();
  if (list.find(m => m.email.toLowerCase() === String(email).toLowerCase())) {
    return res.status(400).json({ success: false, message: 'Email sudah terdaftar' });
  }
  if (list.find(m => m.trade_name.toLowerCase() === String(trade_name).toLowerCase())) {
    return res.status(400).json({ success: false, message: 'Nama Dagang sudah digunakan merchant lain' });
  }
  const m = {
    id: 'mch-' + Date.now(),
    pic_name: String(pic_name).trim(),
    email: String(email).trim().toLowerCase(),
    trade_name: String(trade_name).trim(),
    password_hash: hashPassword(password),
    status: 'pending',
    scale: null,
    balance: 0,
    logo: '',
    website: '',
    registration_steps: {},
    kyc: {},
    geo: {},
    kuesioner: {},
    agreements: {},
    phone: '',
    created_at: new Date().toISOString()
  };
  list.push(m);
  writeMerchants(list);
  pushAudit(auditEntry({ action: 'merchant_register', actor: m.email, ip: req.ip, detail: { trade_name: m.trade_name } }));
  res.json({ success: true, data: { merchant: publicMerchant(m), token: merchantToken(m) } });
});

app.post('/api/merchant/login', (req, res) => {
  const { email, password, captcha_id, captcha_answer } = req.body || {};
  const emailNorm = String(email || '').toLowerCase().trim();
  const isDemo = emailNorm === 'merchant@demo.bdpay' && password === 'demo123';
  const cap = verifyCaptcha(captcha_id, captcha_answer);
  if (!cap.ok && !isDemo) return res.status(400).json({ success: false, message: cap.message });
  const m = readMerchants().find(x => x.email === emailNorm);
  if (!m || !verifyPassword(password, m.password_hash)) {
    return res.status(401).json({ success: false, message: 'Email atau password salah' });
  }
  if (m.status === 'on_hold') {
    return res.status(403).json({ success: false, message: 'Akun On-Hold oleh admin' });
  }
  res.json({ success: true, data: { merchant: publicMerchant(m), token: merchantToken(m) } });
});

app.post('/api/merchant/forgot-password', (req, res) => {
  const _capf = verifyCaptcha(req.body?.captcha_id, req.body?.captcha_answer);
  if (!_capf.ok) return res.status(400).json({ success: false, message: _capf.message });
  const email = String(req.body?.email || '').toLowerCase();
  const m = readMerchants().find(x => x.email === email);
  // Always generic response
  res.json({
    success: true,
    message: m
      ? 'Link reset dikirim (simulasi). Gunakan password sementara: reset123 — login lalu ganti di Profil.'
      : 'Jika email terdaftar, instruksi reset akan dikirim.'
  });
  if (m) {
    m.password_hash = hashPassword('reset123');
    const list = readMerchants();
    const i = list.findIndex(x => x.id === m.id);
    if (i >= 0) { list[i] = m; writeMerchants(list); }
  }
});


app.get('/api/merchant/audit', requireMerchant, (req, res) => {
  try {
    const logs = readJSON('audit_log.json');
    const arr = Array.isArray(logs) ? logs : [];
    const mine = arr.filter(a =>
      (a.detail && a.detail.merchant_id === req.merchant.id) ||
      a.actor === req.merchant.email ||
      (a.action || '').startsWith('merchant')
    ).slice(-100).reverse();
    res.json({ success: true, data: mine });
  } catch (e) {
    res.json({ success: true, data: [] });
  }
});

app.get('/api/merchant/config', requireMerchant, (req, res) => {
  const settings = getSettings();
  const products = readJSON('products.json');
  const plist = Array.isArray(products) ? products : (products?.items || []);
  res.json({
    success: true,
    data: {
      tnc: settings.tnc || {},
      fees: settings.fees || {},
      taxes: settings.taxes || {},
      merchant_limits: settings.merchant_limits || UMKM_LIMITS,
      api_payment_priority: settings.api_payment?.priority || ['bdpay', 'midtrans', 'doku', 'xendit'],
      api_ppob_priority: settings.api_ppob?.priority || ['digiflazz', 'iak', 'raja-biller'],
      products: plist.filter(p => p.active !== false).map(p => ({
        id: p.id, name: p.name, price: p.price || p.sell_price, category: p.category, provider: p.provider
      })),
      scale: req.merchant.scale,
      limit: (settings.merchant_limits || UMKM_LIMITS)[req.merchant.scale || 'mikro']
    }
  });
});

app.get('/api/merchant/me', requireMerchant, (req, res) => {
  res.json({ success: true, data: publicMerchant(req.merchant) });
});

app.put('/api/merchant/profile', requireMerchant, (req, res) => {
  const list = readMerchants();
  const i = list.findIndex(x => x.id === req.merchant.id);
  if (i < 0) return res.status(404).json({ success: false, message: 'Not found' });
  const { pic_name, trade_name, logo, website, password } = req.body || {};
  if (trade_name && trade_name !== list[i].trade_name) {
    if (list.find(x => x.id !== list[i].id && x.trade_name.toLowerCase() === trade_name.toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Nama Dagang sudah digunakan' });
    }
    list[i].trade_name = trade_name;
  }
  if (pic_name) list[i].pic_name = pic_name;
  if (logo != null) list[i].logo = logo;
  if (website != null) list[i].website = website;
  if (password) list[i].password_hash = hashPassword(password);
  writeMerchants(list);
  res.json({ success: true, message: 'Profil disimpan', data: publicMerchant(list[i]) });
});


// —— Merchant simulation: OTP / OCR / Liveness ——
function merchantDemoOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

app.post('/api/merchant/otp/send', requireMerchant, (req, res) => {
  const channel = String(req.body?.channel || 'email').toLowerCase(); // email | sms | wa
  const target = String(req.body?.target || (channel === 'email' ? req.merchant.email : req.merchant.phone) || '').trim();
  if (!target) return res.status(400).json({ success: false, message: 'Target OTP wajib (email / nomor HP)' });
  if (!['email', 'sms', 'wa'].includes(channel)) {
    return res.status(400).json({ success: false, message: 'channel: email | sms | wa' });
  }
  const code = merchantDemoOtp();
  const list = readMerchants();
  const i = list.findIndex(x => x.id === req.merchant.id);
  list[i].otp_pending = list[i].otp_pending || {};
  list[i].otp_pending[channel] = {
    code,
    target,
    expires_at: Date.now() + 5 * 60 * 1000,
    created_at: new Date().toISOString()
  };
  if (channel !== 'email') list[i].phone = target;
  writeMerchants(list);
  pushAudit(auditEntry({ action: 'merchant_otp_send', actor: req.merchant.email, ip: req.ip, detail: { channel, target } }));
  res.json({
    success: true,
    message: 'OTP ' + channel.toUpperCase() + ' dikirim (simulasi) ke ' + target,
    data: {
      channel,
      target,
      expires_in_sec: 300,
      demo_otp: code, // tampilkan di UI untuk uji
      simulation: true
    }
  });
});

app.post('/api/merchant/otp/verify', requireMerchant, (req, res) => {
  let channel = String(req.body?.channel || 'email').toLowerCase();
  const code = String(req.body?.otp || req.body?.code || '').trim();
  const list = readMerchants();
  const i = list.findIndex(x => x.id === req.merchant.id);
  const pending = list[i].otp_pending || {};
  // channel "phone" = alias: cek wa, sms, atau phone
  let pend = pending[channel];
  let usedChannel = channel;
  if (!pend && (channel === 'phone' || channel === 'sms' || channel === 'wa')) {
    for (const k of ['wa', 'sms', 'phone']) {
      if (pending[k]) { pend = pending[k]; usedChannel = k; break; }
    }
  }
  if (!pend) return res.status(400).json({ success: false, message: 'Kirim OTP dulu (WhatsApp / SMS)' });
  if (Date.now() > (pend.expires_at || 0)) {
    return res.status(400).json({ success: false, message: 'OTP kedaluwarsa. Kirim ulang.' });
  }
  // Terima kode yang benar ATAU 123456 (bypass uji cepat)
  if (code !== String(pend.code) && code !== '123456') {
    return res.status(400).json({ success: false, message: 'Kode OTP salah' });
  }
  list[i].registration_steps = list[i].registration_steps || {};
  if (usedChannel === 'email' || channel === 'email') {
    list[i].registration_steps.email_verified = true;
    list[i].email_verified = true;
  } else {
    list[i].registration_steps.phone_verified = true;
    list[i].phone_verified = true;
    list[i].phone = pend.target || req.body?.phone || list[i].phone;
  }
  delete list[i].otp_pending[usedChannel];
  if (list[i].otp_pending) {
    delete list[i].otp_pending.phone;
    delete list[i].otp_pending.sms;
    delete list[i].otp_pending.wa;
  }
  writeMerchants(list);
  res.json({
    success: true,
    message: channel === 'email' ? 'Email terverifikasi (simulasi)' : 'Nomor telepon terverifikasi via ' + channel.toUpperCase() + ' (simulasi)'
  });
});

app.post('/api/merchant/verify-email', requireMerchant, (req, res) => {
  // Backward compatible: verify email OTP
  req.body = { ...(req.body || {}), channel: 'email', otp: req.body?.otp };
  const channel = 'email';
  const code = String(req.body?.otp || '').trim();
  const list = readMerchants();
  const i = list.findIndex(x => x.id === req.merchant.id);
  const pend = (list[i].otp_pending || {})[channel];
  if (pend && code && code !== String(pend.code) && code !== '123456') {
    return res.status(400).json({ success: false, message: 'Kode OTP salah' });
  }
  if (!code || code.length < 4) {
    return res.status(400).json({ success: false, message: 'OTP tidak valid. Kirim OTP dulu atau gunakan 123456' });
  }
  list[i].registration_steps = list[i].registration_steps || {};
  list[i].registration_steps.email_verified = true;
  list[i].email_verified = true;
  if (list[i].otp_pending) delete list[i].otp_pending.email;
  writeMerchants(list);
  res.json({ success: true, message: 'Email terverifikasi (simulasi)' });
});

app.post('/api/merchant/liveness', requireMerchant, (req, res) => {
  const { passed, score, frames, simulation, photo, challenges_passed } = req.body || {};
  const sc = Number(score) || 0;
  const ok = passed === true || sc >= 50;
  if (!ok) {
    return res.status(400).json({
      success: false,
      message: 'Liveness gagal (skor ' + sc + '% < 50%). Ulangi: hadapkan wajah, kedip, menoleh.',
      data: { score: sc, simulation: !!simulation }
    });
  }
  const list = readMerchants();
  const i = list.findIndex(x => x.id === req.merchant.id);
  const mid = list[i].id;
  let photoUrl = list[i].liveness?.photo || null;
  if (typeof photo === 'string' && photo.startsWith('data:image') && photo.length > 64) {
    photoUrl = mediaOrKeep(mid, 'liveness', photo, photoUrl) || photo.slice(0, 200000);
  } else if (typeof photo === 'string' && photo.startsWith('/media/')) {
    photoUrl = photo;
  }
  list[i].liveness = {
    passed: true,
    score: sc || 85,
    frames: Number(frames) || 0,
    challenges_passed: Number(challenges_passed) || 0,
    photo: photoUrl,
    at: new Date().toISOString(),
    simulation: simulation === true
  };
  if (!photoUrl) {
    console.warn('[liveness] no photo saved for', list[i].email);
  }
  list[i].registration_steps = list[i].registration_steps || {};
  list[i].registration_steps.liveness_ok = true;
  writeMerchants(list);
  res.json({
    success: true,
    message: 'Liveness berhasil — skor ' + list[i].liveness.score + '%' + (list[i].liveness.simulation ? ' (simulasi)' : ''),
    data: list[i].liveness
  });
});

app.post('/api/merchant/kyc/ocr', requireMerchant, async (req, res) => {
  const body = req.body || {};
  const { nik, nama_ktp, image_name, blur_percent, bypass, imageBase64, ocr_text, ocr_nik, ocr_nama, engineeredDataUrl } = body;
  const nikClean = String(nik || '').replace(/\D/g, '');
  const nama = String(nama_ktp || '').toUpperCase().trim();

  if (bypass) {
    if (nikClean.length !== 16) return res.status(400).json({ success: false, message: 'NIK 16 digit wajib' });
    if (nama.length < 3) return res.status(400).json({ success: false, message: 'Nama KTP wajib' });
    const list = readMerchants();
    const i = list.findIndex(x => x.id === req.merchant.id);
    list[i].kyc = {
      nik: nikClean, nama_ktp: nama, bypass: true, ocr_sim: true,
      image_name: image_name || null, at: new Date().toISOString(),
      nik_match: 100, nama_match: 100, verified: true, simulation: true
    };
    list[i].registration_steps = list[i].registration_steps || {};
    list[i].registration_steps.kyc_done = true;
    writeMerchants(list);
    return res.json({
      success: true,
      message: 'KYC disimpan (simulasi OCR) — NIK & Nama 100%',
      data: list[i].kyc
    });
  }

  if (!imageBase64) {
    return res.status(400).json({ success: false, message: 'Upload foto KTP wajib untuk OCR live' });
  }
  if (nikClean.length !== 16) {
    return res.status(400).json({ success: false, message: 'Isi NIK 16 digit sebelum verifikasi OCR' });
  }
  if (nama.length < 3) {
    return res.status(400).json({ success: false, message: 'Isi Nama sesuai KTP sebelum verifikasi OCR' });
  }

  try {
    const result = await processKYC({
      imageBase64,
      filename: image_name || 'ktp-merchant.jpg',
      hint: { nik: nikClean, nama_ktp: nama, ocr_nik: ocr_nik || '', ocr_nama: ocr_nama || '' },
      ocrText: ocr_text || '',
      engineeredDataUrl: engineeredDataUrl || null,
      bypass: false
    });

    if (!result.ok) {
      return res.status(400).json({
        success: false,
        message: result.message || 'OCR gagal — upload ulang foto KTP',
        data: {
          quality: result.quality, ocr: result.ocr, code: result.code,
          processed_image: result.processed_image || null,
          nik_upscale_image: result.nik_upscale_image || null,
          nama_upscale_image: result.nama_upscale_image || result.verify_image || null
        }
      });
    }

    const ocr = result.ocr || {};
    const nikScore = Number(ocr.nik_score != null ? ocr.nik_score : (result.lock_nik ? 100 : 0));
    const namaScore = Number(ocr.nama_score != null ? ocr.nama_score : (result.lock_nama ? 100 : 0));
    const lockNik = !!(result.lock_nik || ocr.nik_match || nikScore >= 50);
    const lockNama = !!(result.lock_nama || ocr.nama_match || namaScore >= 50);
    const both = lockNik && lockNama;

    const list = readMerchants();
    const i = list.findIndex(x => x.id === req.merchant.id);
    list[i].kyc = {
      nik: nikClean,
      nama_ktp: nama,
      ocr_nik: ocr.nik || ocr_nik || '',
      ocr_nama: ocr.nama_ktp || ocr_nama || '',
      nik_match: nikScore,
      nama_match: namaScore,
      lock_nik: lockNik,
      lock_nama: lockNama,
      verified: both,
      simulation: false,
      blur_percent: result.quality?.blur_percent,
      image_name: image_name || 'ktp.jpg',
      ktp_image: mediaOrKeep(list[i].id, 'ktp_pic', result.original_image || imageBase64, list[i].kyc && list[i].kyc.ktp_image) || null,
      ktp_processed: mediaOrKeep(list[i].id, 'ktp_pic_processed', result.processed_image, list[i].kyc && list[i].kyc.ktp_processed) || null,
      at: new Date().toISOString()
    };
    list[i].registration_steps = list[i].registration_steps || {};
    // only mark kyc_done when both match ≥50%
    if (both) list[i].registration_steps.kyc_done = true;
    else list[i].registration_steps.kyc_done = false;
    writeMerchants(list);

    res.json({
      success: both,
      message: both
        ? ('OCR live berhasil. NIK ' + nikScore + '% · Nama ' + namaScore + '% — terverifikasi')
        : ('OCR selesai. NIK ' + nikScore + '% · Nama ' + namaScore + '% — perlu ≥50% keduanya. Ulangi verifikasi.'),
      data: {
        ...list[i].kyc,
        quality: result.quality,
        lock_nik: lockNik,
        lock_nama: lockNama,
        ocr: ocr,
        processed_image: result.processed_image || null,
        nik_upscale_image: result.nik_upscale_image || null,
        nama_upscale_image: result.nama_upscale_image || result.verify_image || null,
        verify_image: result.verify_image || null,
        original_image: result.original_image || null
      }
    });
  } catch (e) {
    console.error('[merchant/kyc/ocr]', e);
    res.status(500).json({ success: false, message: 'OCR error: ' + (e.message || 'server') });
  }
});

app.post('/api/merchant/google-login', (req, res) => {
  let email = req.body?.email, name = req.body?.name, google_id = req.body?.google_id;
  const credential = req.body?.credential;
  if (credential) {
    try {
      const parts = String(credential).split('.');
      const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      email = payload.email;
      name = payload.name || payload.given_name || email;
      google_id = payload.sub;
      const gcfg = getSettings().google || {};
      if (gcfg.client_id && payload.aud && payload.aud !== gcfg.client_id) {
        return res.status(400).json({ success: false, message: 'Google client_id tidak cocok' });
      }
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Credential Google tidak valid' });
    }
  }
  // no captcha for Google OAuth
  const em = String(email || '').trim().toLowerCase();
  if (!em || !em.includes('@')) {
    return res.status(400).json({ success: false, message: 'Email Google wajib' });
  }
  let list = readMerchants();
  let m = list.find(x => x.email === em);
  if (!m) {
    m = {
      id: 'mch-g-' + Date.now(),
      pic_name: String(name || em.split('@')[0]),
      email: em,
      trade_name: 'UMKM ' + (name || em.split('@')[0]),
      password_hash: hashPassword('google-sim-' + (google_id || Date.now())),
      status: 'pending',
      scale: null,
      balance: 0,
      logo: '',
      website: '',
      registration_steps: { email_verified: true },
      email_verified: true,
      google: { id: google_id || ('sim-' + Date.now()), simulation: true },
      kyc: {},
      geo: {},
      kuesioner: {},
      agreements: {},
      phone: '',
      created_at: new Date().toISOString()
    };
    // pastikan trade name unik
    let tn = m.trade_name;
    let n = 1;
    while (list.find(x => x.trade_name.toLowerCase() === tn.toLowerCase())) {
      tn = m.trade_name + ' ' + (++n);
    }
    m.trade_name = tn;
    list.push(m);
    writeMerchants(list);
  } else {
    m.registration_steps = m.registration_steps || {};
    m.registration_steps.email_verified = true;
    m.email_verified = true;
    m.google = { id: google_id || m.google?.id || 'sim', simulation: !req.body?.credential };
    writeMerchants(list);
  }
  if (m.status === 'on_hold') {
    return res.status(403).json({ success: false, message: 'Akun On-Hold oleh admin' });
  }
  res.json({
    success: true,
    message: 'Login Google berhasil (simulasi)',
    data: { merchant: publicMerchant(m), token: merchantToken(m), simulation: true }
  });
});

app.post('/api/merchant/docs/upload', requireMerchant, (req, res) => {
  const body = req.body || {};
  const doc_type = body.doc_type;
  const file_name = body.file_name || 'doc.jpg';
  const file_size = body.file_size;
  const data_url = body.image || body.data_url || null;
  const allowed = ['ktp_direksi', 'npwp_direksi', 'akta_notaris', 'sk_kemenkumham'];
  if (!allowed.includes(doc_type)) {
    return res.status(400).json({ success: false, message: 'doc_type: ' + allowed.join(' | ') });
  }
  if (!data_url || typeof data_url !== 'string' || !data_url.startsWith('data:')) {
    return res.status(400).json({ success: false, message: 'image/data_url wajib (base64)' });
  }
  const list = readMerchants();
  const i = list.findIndex(x => x.id === req.merchant.id);
  list[i].scale_docs = list[i].scale_docs || {};
  const prev = list[i].scale_docs[doc_type] || {};
  const imgUrl = mediaOrKeep(list[i].id, doc_type, data_url, prev.image);
  list[i].scale_docs[doc_type] = {
    ...prev,
    file_name,
    file_size: Number(file_size) || (data_url.length || 0),
    image: imgUrl || data_url.slice(0, 120000),
    has_data: true,
    verified: false,
    uploaded_at: new Date().toISOString(),
    simulation: false
  };
  writeMerchants(list);
  res.json({
    success: true,
    message: 'Dokumen ' + doc_type + ' tersimpan (simulasi)',
    data: list[i].scale_docs[doc_type]
  });
});


app.post('/api/merchant/verify-trade-name', requireMerchant, (req, res) => {
  const list = readMerchants();
  const me = list.find(x => x.id === req.merchant.id);
  if (!me) return res.status(404).json({ success: false, message: 'Merchant tidak ditemukan' });
  const trade = String(req.body?.trade_name || me.trade_name || '').trim();
  if (trade.length < 3) return res.status(400).json({ success: false, message: 'Nama Dagang minimal 3 karakter' });
  const dup = list.find(x => x.id !== me.id && String(x.trade_name || '').toLowerCase() === trade.toLowerCase());
  if (dup) return res.status(400).json({ success: false, message: 'Nama Dagang sudah dipakai merchant lain. Gunakan nama lain.' });
  me.trade_name = trade;
  me.registration_steps = me.registration_steps || {};
  me.registration_steps.trade_name_ok = true;
  writeMerchants(list);
  res.json({ success: true, message: 'Nama Dagang tersedia dan terverifikasi: ' + trade, data: { trade_name: trade } });
});

app.post('/api/merchant/kyc', requireMerchant, (req, res) => {
  const { nik, nama_ktp, bypass } = req.body || {};
  if (!nik || String(nik).replace(/\D/g, '').length !== 16) {
    return res.status(400).json({ success: false, message: 'NIK 16 digit wajib' });
  }
  const list = readMerchants();
  const i = list.findIndex(x => x.id === req.merchant.id);
  list[i].kyc = { nik: String(nik).replace(/\D/g, ''), nama_ktp: String(nama_ktp || '').toUpperCase(), bypass: !!bypass };
  list[i].registration_steps = list[i].registration_steps || {};
  list[i].registration_steps.kyc_done = true;
  writeMerchants(list);
  res.json({ success: true, message: 'KYC tersimpan (sandbox)' });
});

app.post('/api/merchant/geo', requireMerchant, async (req, res) => {
  const body = req.body || {};
  let lat = Number(body.lat);
  let lng = Number(body.lng);
  const list = readMerchants();
  const i = list.findIndex(x => x.id === req.merchant.id);
  if (i < 0) return res.status(404).json({ success: false, message: 'Merchant tidak ditemukan' });

  let geo = {
    lat: lat || null,
    lng: lng || null,
    kota: body.kota || body.city || '',
    kecamatan: body.kecamatan || '',
    kode_pos: body.kode_pos || body.postcode || '',
    kelurahan: body.kelurahan || '',
    source: body.source || 'client'
  };

  if ((!geo.kota || !geo.kecamatan) && lat && lng) {
    try {
      const g = await reverseGeocode(lat, lng);
      if (g && g.ok) {
        geo = {
          lat, lng,
          kota: g.kota || geo.kota,
          kecamatan: g.kecamatan || geo.kecamatan,
          kode_pos: g.kode_pos || geo.kode_pos,
          kelurahan: g.kelurahan || geo.kelurahan,
          source: g.source || 'reverse'
        };
      }
    } catch (e) {
      console.warn('[merchant/geo]', e.message);
    }
  }

  // simulation fallback
  if (body.simulation || (!geo.kota && !geo.kecamatan)) {
    geo = {
      lat: lat || -7.2575,
      lng: lng || 112.7521,
      kota: geo.kota || 'Surabaya',
      kecamatan: geo.kecamatan || 'Gubeng',
      kode_pos: geo.kode_pos || '60281',
      kelurahan: geo.kelurahan || 'Airlangga',
      source: body.simulation ? 'simulation' : (geo.source || 'fallback')
    };
  }

  list[i].geo = geo;
  list[i].registration_steps = list[i].registration_steps || {};
  list[i].registration_steps.geo_done = true;
  writeMerchants(list);
  res.json({ success: true, message: 'Lokasi GEO tersimpan', data: list[i].geo });
});

app.post('/api/merchant/agree', requireMerchant, (req, res) => {
  const type = String(req.body?.type || '');
  const list = readMerchants();
  const i = list.findIndex(x => x.id === req.merchant.id);
  list[i].registration_steps = list[i].registration_steps || {};
  list[i].agreements = list[i].agreements || {};
  if (type === 'tnc') {
    list[i].registration_steps.tnc_ok = true;
    list[i].tnc_accepted = true;
  } else if (type === 'agreement') {
    list[i].registration_steps.agreement_ok = true;
    list[i].agreement_accepted = true;
  } else if (['aml', 'consumer', 'infosec', 'cyber', 'law'].includes(type)) {
    list[i].agreements[type] = true;
    if (['aml', 'consumer', 'infosec', 'cyber', 'law'].every(k => list[i].agreements[k])) {
      list[i].registration_steps.aml_ok = true;
    }
  } else {
    return res.status(400).json({ success: false, message: 'Tipe persetujuan tidak valid' });
  }
  writeMerchants(list);
  res.json({ success: true, message: 'Persetujuan ' + type + ' disimpan', data: { registration_steps: list[i].registration_steps, agreements: list[i].agreements } });
});

app.post('/api/merchant/set-scale-only', requireMerchant, (req, res) => {
  const scale = String(req.body?.scale || '').toLowerCase();
  if (!['mikro', 'kecil', 'menengah'].includes(scale)) {
    return res.status(400).json({ success: false, message: 'Skala: mikro / kecil / menengah' });
  }
  const list = readMerchants();
  const i = list.findIndex(x => x.id === req.merchant.id);
  if (i < 0) return res.status(404).json({ success: false, message: 'Merchant tidak ditemukan' });
  list[i].scale = scale;
  list[i].registration_steps = list[i].registration_steps || {};
  list[i].registration_steps.scale_set = true;
  writeMerchants(list);
  res.json({
    success: true,
    message: 'Kategori ' + scale.toUpperCase() + ' ditetapkan',
    data: publicMerchant(list[i])
  });
});

app.post('/api/merchant/set-scale', requireMerchant, (req, res) => {
  let { scale, phone, otp, liveness, docs } = req.body || {};
  scale = String(scale || '').toLowerCase();
  if (!['mikro', 'kecil', 'menengah'].includes(scale)) {
    return res.status(400).json({ success: false, message: 'Skala: mikro / kecil / menengah' });
  }
  if (!liveness && !req.merchant.liveness?.passed) {
    return res.status(400).json({ success: false, message: 'Liveness wajib (jalankan simulasi liveness)' });
  }
  const phoneOk = !!(req.merchant.phone_verified || req.merchant.registration_steps?.phone_verified);
  if (!phoneOk && (!otp || String(otp).length < 4)) {
    return res.status(400).json({ success: false, message: 'OTP telepon wajib (kirim & verifikasi SMS/WA dulu)' });
  }
  if (scale === 'menengah') {
    const list0 = readMerchants();
    const me0 = list0.find(x => x.id === req.merchant.id) || {};
    const stored = me0.scale_docs || {};
    const d = docs || {};
    const need = ['ktp_direksi', 'npwp_direksi', 'akta_notaris', 'sk_kemenkumham'];
    const miss = need.filter(k => !(d[k] || stored[k]));
    if (miss.length) {
      return res.status(400).json({ success: false, message: 'Skala Menengah wajib unggah: ' + miss.join(', ') + ' (gunakan Upload Dokumen simulasi)' });
    }
  }
  const list = readMerchants();
  const i = list.findIndex(x => x.id === req.merchant.id);
  list[i].scale = scale;
  list[i].phone = phone || list[i].phone;
  if (docs) list[i].scale_docs = {
    ktp_direksi: !!docs.ktp_direksi,
    npwp_direksi: !!docs.npwp_direksi,
    akta_notaris: !!docs.akta_notaris,
    sk_kemenkumham: !!docs.sk_kemenkumham,
    // store small meta only (sandbox) — full base64 optional
    uploaded_at: new Date().toISOString()
  };
  list[i].registration_steps = list[i].registration_steps || {};
  list[i].registration_steps.scale_set = true;
  writeMerchants(list);
  res.json({ success: true, message: 'Skala ' + scale + ' disimpan. Limit: ' + JSON.stringify(UMKM_LIMITS[scale]) });
});



app.post('/api/merchant/wizard/reset', requireMerchant, (req, res) => {
  // PIC boleh mengedit ulang: ulangi proses registrasi dari awal hingga approval otomatis
  const list = readMerchants();
  const i = list.findIndex(x => x.id === req.merchant.id);
  if (i < 0) return res.status(404).json({ success: false, message: 'Not found' });
  const m = list[i];
  // Pertahankan identitas dasar
  const keep = {
    id: m.id,
    email: m.email,
    password_hash: m.password_hash,
    pic_name: m.pic_name,
    trade_name: m.trade_name,
    logo: m.logo,
    website: m.website,
    balance: m.balance || 0,
    created_at: m.created_at,
    google: m.google
  };
  list[i] = {
    ...keep,
    status: 'pending',
    scale: null,
    phone: m.phone || '',
    email_verified: false,
    phone_verified: false,
    registration_steps: {},
    wizard: { stage: 'pic', reset_at: new Date().toISOString(), edit_count: (m.wizard?.edit_count || 0) + 1 },
    kyc: {},
    geo: {},
    kuesioner: {},
    agreements: {},
    scale_docs: {},
    liveness: null,
    otp_pending: {},
    approved_at: null
  };
  writeMerchants(list);
  pushAudit(auditEntry({ action: 'merchant_wizard_reset', actor: m.email, ip: req.ip, detail: { id: m.id } }));
  res.json({
    success: true,
    message: 'Mode edit: ulangi registrasi dari awal (PIC → UMKM → Kuesioner → Persetujuan) hingga approval otomatis.',
    data: publicMerchant(list[i])
  });
});

app.post('/api/merchant/wizard/pic', requireMerchant, (req, res) => {
  // Validasi PIC lengkap lalu set stage umkm
  const list = readMerchants();
  const i = list.findIndex(x => x.id === req.merchant.id);
  const m = list[i];
  const st = m.registration_steps || {};
  const miss = [];
  if (!st.email_verified && !m.email_verified) miss.push('Verifikasi Email');
  if (!st.trade_name_ok) miss.push('Nama Dagang');
  if (!st.kyc_done) miss.push('Verifikasi OCR KTP');
  if (!st.geo_done) miss.push('Lokasi GEO');
  if (!st.tnc_ok) miss.push('S&K');
  if (!st.agreement_ok) miss.push('Agreement');
  if (miss.length) {
    return res.status(400).json({ success: false, message: 'Belum lengkap: ' + miss.join(', ') });
  }
  m.wizard = m.wizard || {};
  m.wizard.pic_done = true;
  m.wizard.stage = 'umkm';
  m.wizard.pic_saved_at = new Date().toISOString();
  writeMerchants(list);
  res.json({ success: true, message: 'Data PIC disimpan. Lanjut Registrasi UMKM.', data: publicMerchant(m) });
});

app.post('/api/merchant/wizard/umkm', requireMerchant, (req, res) => {
  const list = readMerchants();
  const i = list.findIndex(x => x.id === req.merchant.id);
  const m = list[i];
  const st = m.registration_steps || {};
  if (!m.wizard?.pic_done) {
    return res.status(400).json({ success: false, message: 'Selesaikan & simpan Registrasi PIC dulu' });
  }
  if (!st.scale_set || !m.scale) {
    return res.status(400).json({ success: false, message: 'Pilih kategori & selesaikan verifikasi skala' });
  }
  if (!st.liveness_ok && !m.liveness?.passed) {
    return res.status(400).json({ success: false, message: 'Liveness wajib' });
  }
  if (!st.phone_verified && !m.phone_verified) {
    return res.status(400).json({ success: false, message: 'OTP telepon wajib' });
  }
  if (m.scale === 'menengah') {
    const d = m.scale_docs || {};
    const need = ['ktp_direksi', 'npwp_direksi', 'akta_notaris', 'sk_kemenkumham'];
    const miss = need.filter(k => !d[k] || !(d[k].verified || d[k].file_name || d[k] === true));
    // accept if verified flags or upload meta
    const miss2 = need.filter(k => {
      const x = d[k];
      if (!x) return true;
      if (x.verified) return false;
      if (x.file_name || x.number) return false;
      return true;
    });
    if (miss2.length) {
      return res.status(400).json({ success: false, message: 'Dokumen Menengah belum lengkap: ' + miss2.join(', ') });
    }
  }
  m.wizard.umkm_done = true;
  m.wizard.stage = 'kuesioner';
  m.wizard.umkm_saved_at = new Date().toISOString();
  writeMerchants(list);
  res.json({ success: true, message: 'Data UMKM disimpan. Lanjut Kuesioner.', data: publicMerchant(m) });
});


// Simpan dokumen menengah (tetap tersimpan meskipun diminta upload ulang)
app.post('/api/merchant/wizard/docs', requireMerchant, (req, res) => {
  try {
    const body = req.body || {};
    const doc_type = String(body.doc_type || '');
    const allowed = ['ktp_direksi', 'npwp_direksi', 'akta_notaris', 'sk_kemenkumham'];
    if (!allowed.includes(doc_type)) {
      return res.status(400).json({ success: false, message: 'doc_type tidak valid' });
    }
    const list = readMerchants();
    const i = list.findIndex(x => x.id === req.merchant.id);
    if (i < 0) return res.status(404).json({ success: false, message: 'Merchant tidak ditemukan' });
    list[i].scale_docs = list[i].scale_docs || {};
    const prev = list[i].scale_docs[doc_type] || {};
    const imageBase64 = body.imageBase64 || body.image || null;
    const img = mediaOrKeep(list[i].id, doc_type, imageBase64, prev.image)
      || (typeof imageBase64 === 'string' && imageBase64.startsWith('/media/') ? imageBase64 : prev.image);
    const proc = mediaOrKeep(list[i].id, doc_type + '_processed', body.processed_image, prev.processed_image)
      || prev.processed_image || null;
    list[i].scale_docs[doc_type] = {
      ...prev,
      number: body.number != null ? String(body.number).trim() : (prev.number || ''),
      nik: doc_type === 'ktp_direksi' ? String(body.number || prev.nik || '').replace(/\D/g, '') : prev.nik,
      nama: body.nama ? String(body.nama).toUpperCase() : (prev.nama || undefined),
      file_name: body.image_name || prev.file_name || null,
      image: img,
      processed_image: proc,
      verified: body.verified === true ? true : (body.verified === false ? false : !!prev.verified),
      pending_reupload: !!body.pending_reupload,
      ocr: body.ocr || prev.ocr || null,
      updated_at: new Date().toISOString()
    };
    writeMerchants(list);
    res.json({ success: true, message: 'Dokumen tersimpan', data: list[i].scale_docs[doc_type] });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/merchant/docs/verify-sim', requireMerchant, (req, res) => {
  const { doc_type, number, file_name, nama, image } = req.body || {};
  const allowed = ['ktp_direksi', 'npwp_direksi', 'akta_notaris', 'sk_kemenkumham'];
  if (!allowed.includes(doc_type)) {
    return res.status(400).json({ success: false, message: 'doc_type tidak valid' });
  }
  if (!number || String(number).trim().length < 2) {
    return res.status(400).json({ success: false, message: 'Nomor dokumen wajib' });
  }
  const list = readMerchants();
  const i = list.findIndex(x => x.id === req.merchant.id);
  list[i].scale_docs = list[i].scale_docs || {};
  const prevSim = list[i].scale_docs[doc_type] || {};
  const img = mediaOrKeep(list[i].id, doc_type, image, prevSim.image)
    || (typeof image === 'string' && image.startsWith('/media/') ? image : prevSim.image);
  list[i].scale_docs[doc_type] = {
    number: String(number).trim(),
    nik: doc_type === 'ktp_direksi' ? String(number).replace(/\D/g, '') : undefined,
    nama: nama ? String(nama).toUpperCase() : undefined,
    file_name: file_name || null,
    image: img,
    verified: true,
    match_percent: 92 + Math.floor(Math.random() * 7),
    simulation: true,
    verified_at: new Date().toISOString()
  };
  writeMerchants(list);
  res.json({
    success: true,
    message: 'Verifikasi OCR ' + doc_type + ' berhasil (simulasi)',
    data: list[i].scale_docs[doc_type]
  });
});

app.post('/api/merchant/docs/verify-ocr', requireMerchant, async (req, res) => {
  try {
    const body = req.body || {};
    const doc_type = String(body.doc_type || '');
    const allowed = ['ktp_direksi', 'npwp_direksi', 'akta_notaris', 'sk_kemenkumham'];
    if (!allowed.includes(doc_type)) {
      return res.status(400).json({ success: false, message: 'doc_type tidak valid' });
    }
    const number = String(body.number || '').trim();
    const nama = String(body.nama || '').trim();
    const phase = String(body.phase || 'final');
    let imageBase64 = body.imageBase64 || body.image || null;
    if (!imageBase64) {
      try {
        const stored = (req.merchant.scale_docs || {})[doc_type];
        if (stored && stored.image) imageBase64 = stored.image;
      } catch (_) {}
    }

    let quality = null, processed_image = null, code = null;
    const hasKyc = typeof processKYC === 'function';
    if (imageBase64 && hasKyc) {
      try {
        const result = await processKYC({
          imageBase64,
          filename: body.image_name || 'doc.jpg',
          hint: { nik: number.replace(/\D/g, ''), nama_ktp: nama },
          ocrText: body.ocr_text || '',
          bypass: false
        });
        quality = result.quality;
        processed_image = result.processed_image || body.processed_image || null;
        code = result.code;
        if (phase === 'upload' && !result.ok && ['BLUR_TOO_HIGH','ANTIFAKE_FAIL','REFLECTION','THIN_PRINT','EDITED_SOFTWARE','INVALID_IMAGE'].includes(result.code)) {
          return res.status(400).json({
            success: false,
            message: result.message || 'Upload ulang dokumen',
            data: { code: result.code, quality: result.quality, processed_image }
          });
        }
      } catch (e) {
        console.warn('docs processKYC', e.message);
        processed_image = body.processed_image || null;
      }
    } else {
      processed_image = body.processed_image || null;
    }

    if (phase === 'upload') {
      return res.json({
        success: true,
        message: 'Upload OK — lanjut OCR',
        data: { quality, processed_image, code }
      });
    }

    let nikScore = Number(body.nik_score) || 0;
    let namaScore = Number(body.nama_score) || 0;
    let numScore = Number(body.number_score) || 0;
    // KTP Direksi: samakan scoring dengan PIC (processKYC + hint OCR client)
    if (doc_type === 'ktp_direksi' && imageBase64 && typeof processKYC === 'function') {
      try {
        const kycRes = await processKYC({
          imageBase64,
          filename: body.image_name || 'ktp-direksi.jpg',
          hint: {
            nik: String(number || '').replace(/\D/g, ''),
            nama_ktp: String(nama || ''),
            ocr_nik: body.ocr_nik || '',
            ocr_nama: body.ocr_nama || ''
          },
          ocrText: body.ocr_text || '',
          engineeredDataUrl: processed_image || body.processed_image || null,
          bypass: false
        });
        if (kycRes && kycRes.ocr) {
          const ns = Number(kycRes.ocr.nik_score != null ? kycRes.ocr.nik_score : 0);
          const ms = Number(kycRes.ocr.nama_score != null ? kycRes.ocr.nama_score : 0);
          if (ns > nikScore) nikScore = ns;
          if (ms > namaScore) namaScore = ms;
          if (!processed_image && kycRes.processed_image) processed_image = kycRes.processed_image;
          body.ocr_nik = body.ocr_nik || kycRes.ocr.nik || '';
          body.ocr_nama = body.ocr_nama || kycRes.ocr.nama_ktp || '';
        }
      } catch (e) {
        console.warn('ktp_direksi processKYC', e.message);
      }
    }
    let verified = false;
    let match_percent = 0;
    if (doc_type === 'ktp_direksi') {
      verified = nikScore >= 50 && namaScore >= 50;
      match_percent = Math.round((nikScore + namaScore) / 2);
    } else {
      verified = numScore >= 50;
      match_percent = numScore;
    }

    const list = readMerchants();
    const i = list.findIndex(x => x.id === req.merchant.id);
    list[i].scale_docs = list[i].scale_docs || {};
    const prevDoc = list[i].scale_docs[doc_type] || {};
    const img = mediaOrKeep(list[i].id, doc_type, imageBase64, prevDoc.image)
      || (typeof imageBase64 === 'string' && imageBase64.startsWith('/media/') ? imageBase64 : prevDoc.image);
    const proc = mediaOrKeep(list[i].id, doc_type + '_processed', processed_image, prevDoc.processed_image)
      || (typeof processed_image === 'string' && processed_image.startsWith('/media/') ? processed_image : null);

    list[i].scale_docs[doc_type] = {
      number,
      nik: doc_type === 'ktp_direksi' ? number.replace(/\D/g, '') : undefined,
      nama: nama ? nama.toUpperCase() : undefined,
      file_name: body.image_name || null,
      image: img,
      processed_image: proc,
      ocr_nik: body.ocr_nik || null,
      ocr_nama: body.ocr_nama || null,
      ocr_number: body.ocr_number || null,
      nik_score: nikScore,
      nama_score: namaScore,
      number_score: numScore,
      verified,
      match_percent,
      simulation: false,
      verified_at: verified ? new Date().toISOString() : null,
      quality
    };
    writeMerchants(list);

    res.json({
      success: verified,
      message: verified
        ? ('Dokumen ' + doc_type + ' terverifikasi (' + match_percent + '%)')
        : ('Matching < 50%. Perbaiki input / foto dan verifikasi ulang. Skor: ' + match_percent + '%'),
      data: list[i].scale_docs[doc_type]
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message || 'OCR gagal' });
  }
});


app.post('/api/merchant/kuesioner', requireMerchant, (req, res) => {
  const body = req.body || {};
  const list = readMerchants();
  const i = list.findIndex(x => x.id === req.merchant.id);
  const scale = list[i].scale || 'mikro';
  const karyawan_bucket = String(body.karyawan_bucket || '');
  const kategori_usaha = String(body.kategori_usaha || '');
  const kategori_lainnya = String(body.kategori_lainnya || '');
  const jenis = String(body.jenis_barang_jasa || '');
  const harga_bucket = String(body.harga_bucket || '');
  const omset_bucket = String(body.omset_bucket || '');

  if (!karyawan_bucket || !kategori_usaha || !jenis || !harga_bucket || !omset_bucket) {
    return res.status(400).json({ success: false, message: 'Lengkapi semua pilihan kuesioner' });
  }
  if (kategori_usaha === 'Lainnya' && !kategori_lainnya.trim()) {
    return res.status(400).json({ success: false, message: 'Isi kategori usaha Lainnya' });
  }

  const issues = [];
  if (!matchKaryawanBucket(scale, karyawan_bucket)) {
    issues.push('Jumlah karyawan tidak sesuai skala ' + scale + ' (aturan: ' + (MERCHANT_PROFILE_RULES[scale]||{}).karyawan + ')');
  }
  if (!matchHargaBucket(scale, harga_bucket)) {
    issues.push('Harga rata-rata tidak sesuai skala ' + scale);
  }
  if (!matchOmsetBucket(scale, omset_bucket)) {
    issues.push('Omset harian tidak sesuai skala ' + scale);
  }

  const omset_bulanan = omsetBulananFromBucket(omset_bucket);
  const kuesioner = {
    karyawan_bucket,
    kategori_usaha: kategori_usaha === 'Lainnya' ? ('Lainnya: ' + kategori_lainnya) : kategori_usaha,
    jenis_barang_jasa: jenis,
    harga_bucket,
    omset_bucket,
    omset_bulanan,
    omset_bulanan_locked: true,
    scale_at_submit: scale
  };

  list[i].kuesioner = kuesioner;
  list[i].registration_steps = list[i].registration_steps || {};
  list[i].wizard = list[i].wizard || {};

  if (issues.length) {
    list[i].registration_steps.kuesioner_ok = false;
    list[i].aml_check = { pass: false, issues };
    writeMerchants(list);
    return res.status(400).json({
      success: false,
      message: 'Profil tidak sesuai kategori. Ulangi pemilihan: ' + issues.join('; '),
      data: { kuesioner, issues, rules: MERCHANT_PROFILE_RULES[scale] }
    });
  }

  list[i].registration_steps.kuesioner_ok = true;
  list[i].aml_check = { pass: true, issues: [] };
  list[i].wizard.stage = 'agreements';
  writeMerchants(list);
  res.json({
    success: true,
    message: 'Kuesioner lulus. Omset bulanan (terkunci): Rp ' + omset_bulanan.toLocaleString('id-ID'),
    data: { kuesioner, rules: MERCHANT_PROFILE_RULES[scale] }
  });
});

app.post('/api/merchant/agree-pack', requireMerchant, (req, res) => {
  const list = readMerchants();
  const i = list.findIndex(x => x.id === req.merchant.id);
  list[i].agreements = { aml: true, consumer: true, infosec: true, cyber: true, law: true };
  list[i].registration_steps = list[i].registration_steps || {};
  list[i].registration_steps.aml_ok = true;
  writeMerchants(list);
  res.json({ success: true, message: 'Semua persetujuan AML, Konsumen, Infosec, Siber, Hukum disetujui' });
});

app.post('/api/merchant/finalize', requireMerchant, (req, res) => {
  const list = readMerchants();
  const i = list.findIndex(x => x.id === req.merchant.id);
  const s = list[i].registration_steps || {};
  const need = ['email_verified', 'trade_name_ok', 'kyc_done', 'geo_done', 'tnc_ok', 'agreement_ok', 'scale_set', 'kuesioner_ok', 'aml_ok'];
  const missing = need.filter(k => !s[k]);
  if (missing.length) {
    return res.status(400).json({ success: false, message: 'Langkah belum selesai: ' + missing.join(', ') });
  }
  list[i].status = 'verified';
  list[i].approved_at = new Date().toISOString();
  list[i].balance = list[i].balance || 0;
  list[i].wizard = list[i].wizard || {};
  list[i].wizard.stage = 'done';
  list[i].wizard.completed_at = list[i].approved_at;
  writeMerchants(list);
  pushAudit(auditEntry({ action: 'merchant_auto_approved', actor: list[i].email, ip: req.ip, detail: { scale: list[i].scale } }));
  res.json({ success: true, message: 'Selamat! Merchant UMKM disetujui otomatis (Verified).', data: publicMerchant(list[i]) });
});

function merchantTxFile() {
  const list = readJSON('merchant_transactions.json');
  return Array.isArray(list) ? list : [];
}
function writeMerchantTx(arr) { writeJSON('merchant_transactions.json', arr); }

function mirrorMerchantTxToTransfers(row, merchant) {
  try {
    const list = readJSON('transfers.json');
    const arr = Array.isArray(list) ? list : [];
    if (arr.find(x => x.order_no === row.order_no || x.id === row.id)) {
      // update status if needed
      const i = arr.findIndex(x => x.order_no === row.order_no || x.id === row.id);
      if (i >= 0 && row.status) {
        arr[i].status = row.status;
        arr[i].paid_at = row.paid_at || arr[i].paid_at;
        writeJSON('transfers.json', arr);
      }
      return;
    }
    arr.push({
      id: row.id,
      order_no: row.order_no,
      va_number: row.va_number,
      amount: row.grand_total != null ? row.grand_total : row.amount,
      base_amount: row.base_amount != null ? row.base_amount : row.amount,
      fee: row.fee || 0,
      tax: row.tax || 0,
      grand_total: row.grand_total != null ? row.grand_total : row.amount,
      fee_lines: row.fee_lines || [],
      tax_lines: row.tax_lines || [],
      bank: row.bank,
      account: row.account,
      name: row.name,
      status: row.status || 'pending',
      provider: row.provider || 'bdpay',
      source: 'merchant',
      merchant_id: row.merchant_id,
      trade_name: (merchant && merchant.trade_name) || row.trade_name,
      pic_nik: row.pic_nik || (merchant && merchant.kyc && merchant.kyc.nik) || '',
      type: row.type || 'merchant_transfer',
      invoice_no: row.invoice_no,
      po_no: row.po_no,
      qo_no: row.qo_no,
      sales_no: row.sales_no,
      reference_no: row.reference_no,
      channel_label: 'bdPay Merchant',
      payment_mode: row.payment_mode || 'sandbox',
      created_at: row.created_at || new Date().toISOString()
    });
    writeJSON('transfers.json', arr);
    try {
      if (merchant && merchant.id) {
        const r = evaluateRisk({ txs: collectAllTxs(), actorId: merchant.id, currentTx: row, cfg: getMlConfig(getSettings()) });
        applyRiskActions('merchant', merchant, r.risk, r.factors);
      }
    } catch (e2) { /* score after mirror */ }
  } catch (e) { console.error('mirrorMerchantTx', e.message); }
}

function checkMerchantLimits(merchant, amount, count) {
  try {
    const scale = (merchant && merchant.scale) || 'mikro';
    const s = getSettings();
    const base = (s.merchant_limits && s.merchant_limits[scale]) || (typeof UMKM_LIMITS !== 'undefined' ? UMKM_LIMITS[scale] : null) || { max_per_transfer: 50000000, max_per_day: 100000000 };
    const amt = Number(amount) || 0;
    if (base.max_per_transfer && amt > Number(base.max_per_transfer)) {
      return 'Melebihi limit per transaksi (' + Number(base.max_per_transfer).toLocaleString('id-ID') + ') untuk skala ' + scale;
    }
    // daily sum from merchant txs
    const txs = merchantTxFile().filter(t => t.merchant_id === merchant.id);
    const day = new Date().toISOString().slice(0, 10);
    const daySum = txs.filter(t => String(t.created_at || '').startsWith(day) && t.status !== 'failed' && t.status !== 'cancelled')
      .reduce((s, t) => s + Number(t.grand_total != null ? t.grand_total : t.amount || 0), 0);
    if (base.max_per_day && (daySum + amt) > Number(base.max_per_day)) {
      return 'Melebihi limit harian (' + Number(base.max_per_day).toLocaleString('id-ID') + ') untuk skala ' + scale;
    }
    return null;
  } catch (e) {
    console.warn('checkMerchantLimits', e.message);
    return null;
  }
}


app.post('/api/merchant/inquiry-account', requireMerchant, (req, res) => {
  const { bank, account } = req.body || {};
  if (!account) return res.status(400).json({ success: false, message: 'Nomor rekening wajib' });
  // Simulasi inquiry (cooldown bisa ditambah)
  const name = 'PENERIMA ' + String(account).slice(-4);
  res.json({ success: true, data: { bank, account, name, account_name: name, simulation: true } });
});

app.post('/api/merchant/saldo/activate', requireMerchant, (req, res) => {
  if (req.merchant.status !== 'verified') return res.status(403).json({ success: false, message: 'Harus Verified' });
  const { bank, account, name, amount } = req.body || {};
  const base = Number(amount) || 0;
  if (!account || base < 10000) return res.status(400).json({ success: false, message: 'Rekening & nominal min 10.000' });
  const settings = getSettings();
  const ft = calcTransferFeesAndTax(base, settings);
  const grand = ft.grand || (base + (ft.fee || 0) + (ft.tax || 0));
  const order_no = 'MTP-' + Date.now();
  const va = '87' + String(Math.floor(Math.random() * 1e10)).padStart(10, '0');
  const id = uuidv4();
  const row = {
    id, merchant_id: req.merchant.id,
    type: 'saldo_topup',
    order_no, ref_id: order_no,
    bank, account, name,
    amount: grand, base_amount: base,
    fee: ft.fee || 0, tax: ft.tax || 0,
    fee_lines: ft.feeLines || [], tax_lines: ft.taxLines || [],
    grand_total: grand,
    va_number: va, status: 'pending',
    provider: selectPaymentProvider(settings) || 'bdpay',
    source: 'merchant',
    channel_label: 'bdPay Merchant',
    trade_name: req.merchant.trade_name,
    pic_nik: (req.merchant.kyc && req.merchant.kyc.nik) || '',
    receipt_url: '/api/merchant/receipt/' + id,
    share_text: 'Aktivasi Saldo\\nOrder: ' + order_no + '\\nVA: ' + va + '\\nNominal: ' + grand,
    created_at: new Date().toISOString()
  };
  const txs = merchantTxFile();
  txs.push(row);
  writeMerchantTx(txs);
  mirrorMerchantTxToTransfers(row, req.merchant);
  res.json({ success: true, message: 'VA top-up diterbitkan', data: row });
});

app.post('/api/merchant/saldo/confirm', requireMerchant, (req, res) => {
  const { order_no, va_number } = req.body || {};
  const txs = merchantTxFile();
  let t = null;
  if (order_no) t = txs.find(x => x.order_no === order_no && x.merchant_id === req.merchant.id);
  if (!t && va_number) t = txs.find(x => String(x.va_number) === String(va_number) && x.merchant_id === req.merchant.id);
  if (!t) return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
  t.status = 'paid';
  t.paid_at = new Date().toISOString();
  t.paid_via = 'merchant_simulation';
  writeMerchantTx(txs);
  // sync transfers.json
  try {
    const list = readJSON('transfers.json');
    const arr = Array.isArray(list) ? list : [];
    const tr = arr.find(x => x.order_no === t.order_no || String(x.va_number) === String(t.va_number));
    if (tr) {
      tr.status = 'paid';
      tr.paid_at = t.paid_at;
      tr.paid_via = 'merchant_simulation';
      writeJSON('transfers.json', arr);
    } else {
      mirrorMerchantTxToTransfers({ ...t, status: 'paid' }, req.merchant);
    }
  } catch (_) {}
  const listM = readMerchants();
  const i = listM.findIndex(x => x.id === req.merchant.id);
  listM[i].balance = (Number(listM[i].balance) || 0) + Number(t.base_amount || t.amount || 0);
  listM[i].accounts = listM[i].accounts || [];
  if (t.account && !listM[i].accounts.find(a => a.account === t.account && a.bank === t.bank)) {
    listM[i].accounts.push({
      id: 'acc-' + Date.now(), bank: t.bank, account: t.account, name: t.name,
      activated_at: new Date().toISOString()
    });
  }
  writeMerchants(listM);
  res.json({
    success: true,
    message: 'Saldo +' + (t.base_amount || t.amount) + ' · rekening diaktifkan',
    data: { balance: listM[i].balance, accounts: listM[i].accounts, tx: t }
  });
});

app.get('/api/merchant/accounts', requireMerchant, (req, res) => {
  const m = readMerchants().find(x => x.id === req.merchant.id);
  res.json({ success: true, data: (m && m.accounts) || [] });
});

app.post('/api/merchant/disburse', requireMerchant, (req, res) => {
  const { account_id, amount } = req.body || {};
  const amt = Number(amount) || 0;
  const list = readMerchants();
  const i = list.findIndex(x => x.id === req.merchant.id);
  const m = list[i];
  const acc = (m.accounts || []).find(a => a.id === account_id);
  if (!acc) return res.status(400).json({ success: false, message: 'Rekening tidak aktif' });
  if (amt < 10000) return res.status(400).json({ success: false, message: 'Minimal 10.000' });
  const settings = getSettings();
  const ft = calcTransferFeesAndTax(amt, settings);
  const grand = ft.grand != null ? ft.grand : (amt + (ft.fee || 0) + (ft.tax || 0));
  if ((Number(m.balance) || 0) < grand) {
    return res.status(400).json({ success: false, message: 'Saldo tidak cukup. Butuh ' + grand + ' (nominal + biaya + pajak)' });
  }
  m.balance = Number(m.balance) - grand;
  writeMerchants(list);
  const txs = merchantTxFile();
  const order_no = 'MDS-' + Date.now();
  const row = {
    id: uuidv4(), merchant_id: m.id, type: 'disbursement',
    order_no, ref_id: order_no, product_name: 'Disbursement',
    amount: amt,
    fee: ft.fee || 0,
    tax: ft.tax || 0,
    fee_lines: ft.feeLines || [],
    tax_lines: ft.taxLines || [],
    grand_total: grand,
    purpose: 'Bisnis',
    status: 'success',
    provider: 'bdPay Merchant',
    bank: acc.bank, account: acc.account, name: acc.name,
    created_at: new Date().toISOString()
  };
  txs.push(row);
  writeMerchantTx(txs);
  try { mirrorMerchantTxToTransfers(row, m); } catch (_) {}
  res.json({ success: true, message: 'Disbursement berhasil ke ' + acc.name, data: row });
});

// —— Merchant Domestic Transfer / Vendor / PPOB / Receipt ——

app.post('/api/merchant/transfer-bulk', requireMerchant, (req, res) => {
  if (req.merchant.status !== 'verified') return res.status(403).json({ success: false, message: 'Harus Verified' });
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ success: false, message: 'Items kosong' });
  if (items.length > 10) return res.status(400).json({ success: false, message: 'Maks 10 transaksi per upload' });
  const settings = getSettings();
  const payProv = selectPaymentProvider(settings) || 'bdpay';
  const out = [];
  const txs = merchantTxFile();
  for (const item of items) {
    const base = Number(item.amount) || 0;
    if (!item.account || base < 10000) continue;
    const ft = calcTransferFeesAndTax(base, settings);
    const grand = ft.grand != null ? ft.grand : (base + (ft.fee || 0) + (ft.tax || 0));
    const err = checkMerchantLimits(req.merchant, grand, 1);
    if (err) return res.status(400).json({ success: false, message: err });
    const order_no = 'MTR-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    const va = '88' + String(Math.floor(Math.random() * 1e10)).padStart(10, '0');
    const id = uuidv4();
    const row = {
      id, merchant_id: req.merchant.id, type: 'domestic_transfer',
      order_no, ref_id: order_no, bank: item.bank, account: item.account, name: item.name,
      amount: grand, base_amount: base, fee: ft.fee || 0, tax: ft.tax || 0,
      fee_lines: ft.feeLines || [], tax_lines: ft.taxLines || [], grand_total: grand,
      va_number: va, status: 'pending',
      provider: payProv, payment_provider: payProv, payment_mode: 'sandbox',
      source: 'merchant', channel_label: 'bdPay Merchant',
      trade_name: req.merchant.trade_name,
      pic_nik: (req.merchant.kyc && req.merchant.kyc.nik) || '',
      receipt_url: '/api/merchant/receipt/' + id,
      created_at: new Date().toISOString()
    };
    txs.push(row);
    out.push(row);
    mirrorMerchantTxToTransfers(row, req.merchant);
  }
  writeMerchantTx(txs);
  if (!out.length) return res.status(400).json({ success: false, message: 'Tidak ada item valid' });
  res.json({ success: true, message: out.length + ' VA diterbitkan (sandbox bdPay)', data: out });
});

app.post('/api/merchant/transfer', requireMerchant, (req, res) => {
  if (req.merchant.status !== 'verified') return res.status(403).json({ success: false, message: 'Harus Verified' });
  const { bank, account, name, amount } = req.body || {};
  const base = Number(amount) || 0;
  if (!account || base < 10000) return res.status(400).json({ success: false, message: 'Rekening & nominal min 10.000' });
  const settings = getSettings();
  const ft = calcTransferFeesAndTax(base, settings);
  const grand = ft.grand != null ? ft.grand : (base + (ft.fee || 0) + (ft.tax || 0));
  const err = checkMerchantLimits(req.merchant, grand, 1);
  if (err) return res.status(400).json({ success: false, message: err });
  const order_no = 'MTR-' + Date.now();
  const va = '88' + String(Math.floor(Math.random() * 1e10)).padStart(10, '0');
  const id = uuidv4();
  const payProv = selectPaymentProvider(settings) || 'bdpay';
  const row = {
    id, merchant_id: req.merchant.id, type: 'domestic_transfer',
    order_no, ref_id: order_no, bank, account, name,
    amount: grand, base_amount: base, fee: ft.fee || 0, tax: ft.tax || 0,
    fee_lines: ft.feeLines || [], tax_lines: ft.taxLines || [], grand_total: grand,
    va_number: va, status: 'pending',
    provider: payProv, payment_provider: payProv, payment_mode: 'sandbox',
    source: 'merchant', channel_label: 'bdPay Merchant',
    trade_name: req.merchant.trade_name,
    pic_nik: (req.merchant.kyc && req.merchant.kyc.nik) || '',
    receipt_url: '/api/merchant/receipt/' + id,
    created_at: new Date().toISOString()
  };
  const txs = merchantTxFile();
  txs.push(row);
  writeMerchantTx(txs);
  mirrorMerchantTxToTransfers(row, req.merchant);
  res.json({ success: true, message: 'VA Domestic Transfer diterbitkan (sandbox bdPay)', data: row });
});

app.post('/api/merchant/transfer-confirm', requireMerchant, (req, res) => {
  const { order_no, va_number } = req.body || {};
  const txs = merchantTxFile();
  let t = txs.find(x => x.merchant_id === req.merchant.id && (x.order_no === order_no || String(x.va_number) === String(va_number)));
  if (!t) return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
  // Prefer webhook; manual confirm only if sandbox
  t.status = 'paid';
  t.paid_at = new Date().toISOString();
  t.paid_via = 'bdpay_sandbox';
  writeMerchantTx(txs);
  try {
    const list = readJSON('transfers.json');
    const arr = Array.isArray(list) ? list : [];
    const tr = arr.find(x => x.order_no === t.order_no || String(x.va_number) === String(t.va_number));
    if (tr) { tr.status = 'paid'; tr.paid_at = t.paid_at; writeJSON('transfers.json', arr); }
    else mirrorMerchantTxToTransfers({ ...t, status: 'paid' }, req.merchant);
  } catch (_) {}
  res.json({ success: true, message: 'Status paid (sandbox)', data: t });
});

app.post('/api/merchant/vendor-pay', requireMerchant, (req, res) => {
  if (req.merchant.status !== 'verified') return res.status(403).json({ success: false, message: 'Harus Verified' });
  const items = Array.isArray(req.body?.items) ? req.body.items : [req.body || {}];
  const settings = getSettings();
  const payProv = selectPaymentProvider(settings) || 'bdpay';
  const out = [];
  const txs = merchantTxFile();
  for (const item of items) {
    const base = Number(item.amount) || Number(item.nominal) || 0;
    if (!item.account || base < 10000) continue;
    const ft = calcTransferFeesAndTax(base, settings);
    const grand = ft.grand != null ? ft.grand : (base + (ft.fee || 0) + (ft.tax || 0));
    const err = checkMerchantLimits(req.merchant, grand, 1);
    if (err) return res.status(400).json({ success: false, message: err });
    const order_no = 'MVA-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    const va = '89' + String(Math.floor(Math.random() * 1e10)).padStart(10, '0');
    const id = uuidv4();
    const row = {
      id, merchant_id: req.merchant.id, type: 'vendor_pay',
      order_no, ref_id: order_no,
      bank: item.bank, account: item.account, name: item.name,
      amount: grand, base_amount: base, fee: ft.fee || 0, tax: ft.tax || 0,
      fee_lines: ft.feeLines || [], tax_lines: ft.taxLines || [], grand_total: grand,
      invoice_no: item.invoice_no || '', po_no: item.po_no || '', qo_no: item.qo_no || '',
      sales_no: item.sales_no || '', reference_no: item.reference_no || '',
      va_number: va, status: 'pending',
      provider: payProv, payment_provider: payProv, payment_mode: 'sandbox',
      source: 'merchant', channel_label: 'bdPay Merchant',
      trade_name: req.merchant.trade_name,
      pic_nik: (req.merchant.kyc && req.merchant.kyc.nik) || '',
      receipt_url: '/api/merchant/receipt/' + id,
      created_at: new Date().toISOString()
    };
    txs.push(row);
    out.push(row);
    mirrorMerchantTxToTransfers(row, req.merchant);
  }
  writeMerchantTx(txs);
  if (!out.length) return res.status(400).json({ success: false, message: 'Item tidak valid' });
  res.json({ success: true, message: 'VA Vendor diterbitkan (sandbox bdPay)', data: out });
});

app.post('/api/merchant/ppob', requireMerchant, async (req, res) => {
  if (req.merchant.status !== 'verified') return res.status(403).json({ success: false, message: 'Merchant harus Verified' });
  const { product_id, customer_no, payment_method } = req.body || {};
  const method = String(payment_method || 'va').toLowerCase() === 'qris' ? 'qris' : 'va';
  const products = readJSON('products.json');
  const list = Array.isArray(products) ? products : (products?.items || []);
  const product = list.find(p => String(p.id) === String(product_id) && p.active !== false);
  if (!product) return res.status(404).json({ success: false, message: 'Produk tidak ditemukan / nonaktif di Admin' });
  if (!customer_no) return res.status(400).json({ success: false, message: 'Nomor tujuan wajib' });
  const settings = getSettings();
  const ft = calcProductFeesAndTax(product, settings);
  const price = Number(product.price || product.sell_price || 0);
  const grand = ft.total != null ? ft.total : (price + (ft.fee || 0) + (ft.tax || 0));
  const err = checkMerchantLimits(req.merchant, grand, 1);
  if (err) return res.status(400).json({ success: false, message: err });
  const ppobProv = selectPPOBProvider(settings) || 'digiflazz';
  const payProv = selectPaymentProvider(settings) || 'bdpay';
  const order_no = 'MPP-' + Date.now();
  const id = uuidv4();
  let va_number = null, qr_string = null;
  if (method === 'va') va_number = '88' + String(Math.floor(Math.random() * 1e10)).padStart(10, '0');
  else qr_string = '00020101QRIS' + order_no + 'AMT' + grand;
  const row = {
    id, merchant_id: req.merchant.id, type: 'ppob',
    order_no, ref_id: order_no,
    product_id: product.id, product_name: product.name,
    customer_no: String(customer_no),
    amount: grand, base_amount: price, fee: ft.fee || 0, tax: ft.tax || 0,
    fee_lines: ft.feeLines || [], tax_lines: ft.taxLines || [], grand_total: grand,
    payment_method: method, va_number, qr_string,
    status: 'waiting_payment',
    provider: ppobProv + ' / bdPay', payment_provider: payProv, payment_mode: 'sandbox',
    source: 'merchant', channel_label: 'bdPay Merchant',
    trade_name: req.merchant.trade_name, pic_nik: (req.merchant.kyc && req.merchant.kyc.nik) || '',
    created_at: new Date().toISOString()
  };
  const txs = merchantTxFile();
  txs.push(row);
  writeMerchantTx(txs);
  try {
    const allTx = readJSON('transactions.json');
    const arr = Array.isArray(allTx) ? allTx : [];
    arr.push({
      ...row, user_id: 'merchant:' + req.merchant.id, user_name: req.merchant.trade_name,
      nik: row.pic_nik, total: grand, type: 'ppob'
    });
    writeJSON('transactions.json', arr);
  } catch (_) {}
  res.json({ success: true, message: 'Menunggu pembayaran via ' + method.toUpperCase() + ' (sandbox)', data: row });
});

app.get('/api/merchant/ppob/quote', requireMerchant, (req, res) => {
  const product_id = req.query.product_id;
  const products = readJSON('products.json');
  const list = Array.isArray(products) ? products : (products?.items || []);
  const product = list.find(p => String(p.id) === String(product_id) && p.active !== false);
  if (!product) return res.status(404).json({ success: false, message: 'Produk tidak ditemukan' });
  const settings = getSettings();
  const ft = calcProductFeesAndTax(product, settings);
  const price = Number(product.price || product.sell_price || 0);
  res.json({
    success: true,
    data: {
      product: { id: product.id, name: product.name, price },
      fee: ft.fee || 0, tax: ft.tax || 0,
      fee_lines: ft.feeLines || [], tax_lines: ft.taxLines || [],
      total: ft.total != null ? ft.total : (price + (ft.fee || 0) + (ft.tax || 0))
    }
  });
});

app.get('/api/merchant/transactions', requireMerchant, (req, res) => {
  let list = merchantTxFile().filter(t => t.merchant_id === req.merchant.id);
  try {
    const trs = readJSON('transfers.json');
    const arr = Array.isArray(trs) ? trs : [];
    let changed = false;
    list = list.map(t => {
      const hit = arr.find(x => (x.order_no && x.order_no === t.order_no) || (x.va_number && String(x.va_number) === String(t.va_number)));
      if (hit && (hit.status === 'paid' || hit.status === 'success') && t.status !== 'paid' && t.status !== 'success') {
        t.status = 'paid';
        t.paid_at = hit.paid_at || new Date().toISOString();
        changed = true;
      }
      return t;
    });
    if (changed) {
      const all = merchantTxFile();
      list.forEach(t => {
        const i = all.findIndex(x => x.id === t.id);
        if (i >= 0) all[i] = t;
      });
      writeMerchantTx(all);
    }
  } catch (_) {}
  list = list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ success: true, data: list });
});

app.get('/api/merchant/receipt/:id', (req, res) => {
  const txs = merchantTxFile();
  const row = txs.find(x => x.id === req.params.id || x.order_no === req.params.id);
  if (!row) return res.status(404).send('Struk tidak ditemukan');
  const publicUrl = (req.protocol + '://' + req.get('host') + '/api/merchant/receipt/' + row.id);
  const qr = 'https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=' + encodeURIComponent(publicUrl);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Struk ${row.order_no||''}</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:420px;margin:24px auto;padding:16px;color:#0f172a}
    h1{font-size:1.1rem;margin:0 0 12px}
    .va{font-size:1.4rem;font-weight:700;letter-spacing:1px;text-align:center;margin:12px 0}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th{text-align:left;color:#64748b;font-weight:500;padding:4px 0}
    td{text-align:right;padding:4px 0}
    .qr{text-align:center;margin:12px 0}
    .url{font-size:11px;word-break:break-all;color:#0369a1;text-align:center}
    @media print{.no-print{display:none}}
  </style></head><body>
  <h1>Struk Bukti Bayar — bdPay Merchant</h1>
  <div class="va">${row.va_number || row.qr_string || '-'}</div>
  <div class="qr"><img src="${qr}" width="160" height="160" alt="QR"/></div>
  <p class="url">${publicUrl}</p>
  <table>
    <tr><th>Order</th><td>${row.order_no||'-'}</td></tr>
    <tr><th>Jenis</th><td>${row.type||'-'}</td></tr>
    <tr><th>Bank</th><td>${row.bank||'-'}</td></tr>
    <tr><th>Rekening</th><td>${row.account||'-'}</td></tr>
    <tr><th>Nama</th><td>${row.name||'-'}</td></tr>
    <tr><th>Nominal</th><td>Rp ${Number(row.grand_total!=null?row.grand_total:row.amount||0).toLocaleString('id-ID')}</td></tr>
    <tr><th>Biaya</th><td>Rp ${Number(row.fee||0).toLocaleString('id-ID')}</td></tr>
    <tr><th>Pajak</th><td>Rp ${Number(row.tax||0).toLocaleString('id-ID')}</td></tr>
    <tr><th>Invoice</th><td>${row.invoice_no||'-'}</td></tr>
    <tr><th>Status</th><td>${row.status||'-'}</td></tr>
    <tr><th>Provider</th><td>bdPay Merchant (sandbox)</td></tr>
  </table>
  <p class="no-print" style="margin-top:20px;text-align:center">
    <button onclick="window.print()">Cetak / Simpan PDF</button>
  </p>
  <script>if (new URLSearchParams(location.search).get('print')==='1') setTimeout(()=>window.print(),400);</script>
  </body></html>`;
  res.type('html').send(html);
});


// —— Admin: Merchant UMKM, Messages, TNC, Limits, IP ——
app.get('/api/admin/merchants', checkAdmin, (req, res) => {
  res.json({ success: true, data: readMerchants().map(publicMerchant) });
});
app.get('/api/admin/merchants/:id', checkAdmin, (req, res) => {
  const m = readMerchants().find(x => x.id === req.params.id);
  if (!m) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data: publicMerchant(m) });
});
app.put('/api/admin/merchants/:id/status', checkAdmin, (req, res) => {
  const list = readMerchants();
  const i = list.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ success: false, message: 'Not found' });
  const st = req.body?.status;
  if (!['verified', 'on_hold', 'pending'].includes(st)) {
    return res.status(400).json({ success: false, message: 'status: verified|on_hold|pending' });
  }
  list[i].status = st;
  writeMerchants(list);
  pushAudit(auditEntry({ action: 'merchant_status', actor: 'admin', ip: req.ip, detail: { id: list[i].id, status: st } }));
  res.json({ success: true, message: 'Status merchant: ' + st, data: publicMerchant(list[i]) });
});
app.get('/api/admin/merchants/:id/card', checkAdmin, (req, res) => {
  const m = readMerchants().find(x => x.id === req.params.id);
  if (!m) return res.status(404).send('Not found');
  const st = m.registration_steps || {};
  const kq = m.kuesioner || {};
  const geo = m.geo || {};
  const kyc = m.kyc || {};
  const ag = m.agreements || {};
  const wiz = m.wizard || {};
  const row = (k, v) => `<tr><th>${k}</th><td>${v == null || v === '' ? '—' : String(v).replace(/</g,'&lt;')}</td></tr>`;
  const chk = (b) => b ? '✓ Ya' : '—';
  const pre = (o) => `<pre style="margin:0;white-space:pre-wrap;font-size:11px">${JSON.stringify(o||{},null,2).replace(/</g,'&lt;')}</pre>`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Kartu ${m.trade_name||m.id}</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:800px;margin:24px auto;padding:16px;color:#0f172a}
    h1{font-size:1.35rem;margin:0 0 8px} h2{font-size:1rem;margin:20px 0 8px;border-bottom:2px solid #0ea5e9;padding-bottom:4px;color:#0369a1}
    .meta{color:#64748b;font-size:13px;margin-bottom:16px}
    table{border-collapse:collapse;width:100%;margin-bottom:8px}
    th,td{border:1px solid #cbd5e1;padding:7px 10px;text-align:left;font-size:13px;vertical-align:top}
    th{background:#f1f5f9;width:32%;font-weight:600}
    .badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700}
    .ok{background:#dcfce7;color:#166534}.pend{background:#fef9c3;color:#854d0e}.hold{background:#fee2e2;color:#991b1b}
    .actions{margin-bottom:16px} .actions button{padding:8px 14px;margin-right:8px;border-radius:8px;border:1px solid #cbd5e1;background:#0f172a;color:#fff;cursor:pointer}
    @media print{.actions{display:none}}
  </style></head><body>
  <div class="actions"><button onclick="window.print()">Unduh PDF / Cetak</button>
  <button onclick="window.close()" style="background:#64748b">Tutup</button></div>
  <h1>Kartu Registrasi Merchant UMKM</h1>
  <p class="meta">bdPay Merchant · ${new Date().toLocaleString('id-ID')} · ID: ${m.id||''}</p>
  <p><span class="badge ${m.status==='verified'?'ok':(m.status==='on_hold'?'hold':'pend')}">${(m.status||'pending').toUpperCase()}</span>
     &nbsp; Skala: <strong>${(m.scale||'—').toUpperCase()}</strong></p>
  <h2>1. Data PIC</h2>
  <table>
    ${row('Nama PIC', m.pic_name)} ${row('Email', m.email)} ${row('Nama Dagang', m.trade_name)}
    ${row('Telepon', m.phone)} ${row('Email terverifikasi', chk(st.email_verified || m.email_verified))}
  </table>
  <h2>2. KYC</h2>
  <table>${row('NIK', kyc.nik)} ${row('Nama KTP', kyc.nama_ktp)} ${row('KYC selesai', chk(st.kyc_done))}</table>
  <h2>3. GEO</h2>
  <table>${row('Kota', geo.kota)} ${row('Kecamatan', geo.kecamatan)} ${row('Kode Pos', geo.kode_pos)}</table>
  <h2>4. Kuesioner</h2>
  <table>${row('Karyawan', kq.karyawan_bucket)} ${row('Omset harian', kq.omset_bucket)} ${row('Omset bulanan', kq.omset_bulanan)}</table>
  <h2>5. Persetujuan</h2>
  <table>
    ${row('S&K', chk(st.tnc_ok))} ${row('Agreement', chk(st.agreement_ok))}
    ${row('AML', chk(ag.aml))} ${row('Konsumen', chk(ag.consumer))}
    ${row('Infosec', chk(ag.infosec))} ${row('Siber', chk(ag.cyber))} ${row('Hukum', chk(ag.law))}
  </table>
  <h2>6. Ringkasan Registrasi</h2>
  <table>
    ${row('Status Merchant', (m.status||'pending').toUpperCase())}
    ${row('Skala UMKM', (m.scale||'—').toUpperCase())}
    ${row('Saldo', 'Rp ' + Number(m.balance||0).toLocaleString('id-ID'))}
    ${row('Tahap Wizard', ({pic:'PIC',umkm:'UMKM',kuesioner:'Kuesioner',agreements:'Persetujuan',done:'Selesai'}[wiz.stage]||wiz.stage||'—'))}
    ${row('PIC selesai', chk(wiz.pic_done))}
    ${row('UMKM selesai', chk(wiz.umkm_done))}
    ${row('Tanggal simpan PIC', wiz.pic_saved_at ? new Date(wiz.pic_saved_at).toLocaleString('id-ID') : '—')}
    ${row('Tanggal simpan UMKM', wiz.umkm_saved_at ? new Date(wiz.umkm_saved_at).toLocaleString('id-ID') : '—')}
    ${row('Tanggal selesai', wiz.completed_at ? new Date(wiz.completed_at).toLocaleString('id-ID') : (m.approved_at ? new Date(m.approved_at).toLocaleString('id-ID') : '—'))}
    ${row('Disetujui otomatis', m.approved_at ? 'Ya — ' + new Date(m.approved_at).toLocaleString('id-ID') : '—')}
  </table>
  <h2>7. Dokumen & Foto (cetak)</h2>
  <div style="display:flex;flex-wrap:wrap;gap:12px">
    ${(() => {
      const live = m.liveness || {};
      const docs = m.scale_docs || {};
      const imgs = [
        ['Foto KTP PIC', kyc.ktp_image],
        ['Foto KTP Hasil Rekayasa', kyc.ktp_processed],
        ['Foto Liveness', live.photo]
      ];
      if (String(m.scale||'').toLowerCase() === 'menengah') {
        imgs.push(
          ['KTP Direksi', docs.ktp_direksi && docs.ktp_direksi.image],
          ['KTP Direksi Rekayasa', docs.ktp_direksi && docs.ktp_direksi.processed_image],
          ['NPWP', docs.npwp_direksi && docs.npwp_direksi.image],
          ['Akta', docs.akta_notaris && docs.akta_notaris.image],
          ['SK Kemenkumham', docs.sk_kemenkumham && docs.sk_kemenkumham.image]
        );
      }
      return imgs.filter(x => x[1]).map(([lab,src]) =>
        '<div style="text-align:center"><div style="font-size:11px;color:#64748b;margin-bottom:4px">'+lab+'</div>'+
        '<img src="'+String(src).replace(/"/g,'')+'" alt="'+lab+'" style="max-width:200px;max-height:160px;border:1px solid #cbd5e1;border-radius:8px;object-fit:contain;background:#f8fafc"/></div>'
      ).join('') || '<p style="color:#94a3b8;font-size:13px">Belum ada foto tersimpan</p>';
    })()}
  </div>

  <p style="margin-top:24px;font-size:12px;color:#64748b;text-align:center">bdPay Merchant · Kartu Registrasi · Developer: PT AREK ATUR AMANAH · GPLv3 · Build 2026</p>
  </body></html>`;
  res.type('html').send(html);
});

// readMessages/writeMessages already defined (merchant_messages.json)
app.get('/api/admin/messages', checkAdmin, (req, res) => {
  res.json({ success: true, data: readMessages().sort((a,b) => String(b.created_at).localeCompare(String(a.created_at))) });
});
app.post('/api/admin/messages', checkAdmin, (req, res) => {
  const { merchant_id, subject, body } = req.body || {};
  if (!merchant_id || !body) return res.status(400).json({ success: false, message: 'merchant_id & body wajib' });
  const list = readMessages();
  list.push({
    id: 'msg-' + Date.now(), merchant_id, to_merchant_id: merchant_id,
    from: 'admin', to: 'merchant', direction: 'in', unread: true,
    subject: subject || '(dari Admin)', body: String(body),
    created_at: new Date().toISOString()
  });
  writeMessages(list);
  res.json({ success: true, message: 'Pesan terkirim ke merchant' });
});

app.get('/api/admin/ip-lists', checkAdmin, (req, res) => {
  res.json({ success: true, data: readJSON('ip_lists.json') || { whitelist: [], blacklist: [] } });
});
app.put('/api/admin/ip-lists', checkAdmin, (req, res) => {
  const data = {
    whitelist: Array.isArray(req.body?.whitelist) ? req.body.whitelist : [],
    blacklist: Array.isArray(req.body?.blacklist) ? req.body.blacklist : []
  };
  writeJSON('ip_lists.json', data);
  res.json({ success: true, message: 'IP/Domain list disimpan', data });
});

app.get('/api/admin/merchant-limits', checkAdmin, (req, res) => {
  const s = getSettings();
  res.json({ success: true, data: s.merchant_limits || (typeof UMKM_LIMITS !== 'undefined' ? UMKM_LIMITS : {}) });
});
app.put('/api/admin/merchant-limits', checkAdmin, (req, res) => {
  const s = getSettings();
  const body = req.body || {};
  const base = (typeof UMKM_LIMITS !== 'undefined' ? UMKM_LIMITS : { mikro:{}, kecil:{}, menengah:{} });
  s.merchant_limits = {
    mikro: { ...base.mikro, ...(body.mikro || {}) },
    kecil: { ...base.kecil, ...(body.kecil || {}) },
    menengah: { ...base.menengah, ...(body.menengah || {}) }
  };
  writeSettings(s);
  res.json({ success: true, message: 'Limit merchant disimpan', data: s.merchant_limits });
});

app.get('/api/admin/tnc', checkAdmin, (req, res) => {
  const s = getSettings();
  res.json({ success: true, data: s.tnc || {} });
});
app.put('/api/admin/tnc', checkAdmin, (req, res) => {
  const current = getSettings();
  current.tnc = { ...(current.tnc || {}), ...(req.body || {}) };
  writeSettings(current);
  res.json({ success: true, message: 'S&K / Agreement disimpan', data: current.tnc });
});


app.get('/api/merchant/messages', requireMerchant, (req, res) => {
  const mid = req.merchant.id;
  const list = readMessages().filter(m => m.merchant_id === mid || m.to_merchant_id === mid);
  res.json({ success: true, data: list.sort((a,b) => String(b.created_at).localeCompare(String(a.created_at))) });
});
app.post('/api/merchant/messages', requireMerchant, (req, res) => {
  const { subject, body } = req.body || {};
  if (!body) return res.status(400).json({ success: false, message: 'Pesan wajib' });
  const list = readMessages();
  list.push({
    id: 'msg-' + Date.now(),
    merchant_id: req.merchant.id,
    from: 'merchant', to: 'admin', direction: 'out', unread: true,
    subject: subject || '(dari Merchant)',
    body: String(body),
    trade_name: req.merchant.trade_name,
    created_at: new Date().toISOString()
  });
  writeMessages(list);
  res.json({ success: true, message: 'Pesan terkirim ke Admin' });
});


// ========== ML Fraud Settings & Activity ==========
function collectAllTxs() {
  const txs = [];
  const t1 = readJSON('transactions.json');
  (Array.isArray(t1) ? t1 : []).forEach(t => txs.push({ ...t, _src: 'ppob' }));
  const t2 = readJSON('transfers.json');
  (Array.isArray(t2) ? t2 : []).forEach(t => txs.push({ ...t, _src: 'transfer' }));
  const t3 = merchantTxFile ? merchantTxFile() : (readJSON('merchant_transactions.json') || []);
  (Array.isArray(t3) ? t3 : []).forEach(t => txs.push({ ...t, _src: 'merchant' }));
  return txs;
}

function applyRiskActions(actorType, actor, risk, factors) {
  const settings = getSettings();
  const cfg = getMlConfig(settings);
  const warnFrom = cfg.actions.warn_from_risk || 3;
  const holdFrom = cfg.actions.hold_from_risk || 4;
  if (risk >= warnFrom && actorType === 'merchant') {
    try {
      const list = readMessages();
      list.unshift({
        id: 'msg-risk-' + Date.now(),
        merchant_id: actor.id,
        from: 'admin', to: 'merchant', direction: 'in', unread: true,
        subject: 'PERINGATAN Risiko ' + risk,
        body: 'Sistem mendeteksi risiko level ' + risk + '. Faktor: ' + (factors || []).join('; ') + '. Segera tinjau aktivitas Anda.',
        created_at: new Date().toISOString()
      });
      writeMessages(list);
    } catch (_) {}
  }
  if (risk >= holdFrom) {
    if (actorType === 'user') {
      const users = readJSON('users.json');
      const i = users.findIndex(u => u.id === actor.id);
      if (i >= 0 && users[i].status !== 'on_hold') {
        users[i].status = 'on_hold';
        users[i].risk_score = risk;
        users[i].risk_factors = factors;
        writeJSON('users.json', users);
      }
    } else if (actorType === 'merchant') {
      const list = readMerchants();
      const i = list.findIndex(m => m.id === actor.id);
      if (i >= 0 && list[i].status !== 'on_hold') {
        list[i].status = 'on_hold';
        list[i].risk_score = risk;
        list[i].risk_factors = factors;
        writeMerchants(list);
      }
    }
  }
}

function scoreActor(actorType, actor) {
  const settings = getSettings();
  const cfg = getMlConfig(settings);
  const txs = collectAllTxs();
  const r = evaluateRisk({
    txs,
    actorId: actor.id,
    currentTx: null,
    deviceId: null,
    knownDevices: actor.known_devices || [],
    locationKey: null,
    knownLocations: actor.known_locations || [],
    cfg
  });
  return r;
}

app.get('/api/admin/ml', checkAdmin, (req, res) => {
  const s = getSettings();
  res.json({ success: true, data: getMlConfig(s) });
});
app.put('/api/admin/ml', checkAdmin, (req, res) => {
  const s = getSettings();
  s.ml = { ...getMlConfig(s), ...(req.body || {}) };
  if (req.body?.fraud) s.ml.fraud = { ...getMlConfig(s).fraud, ...req.body.fraud, weights: { ...getMlConfig(s).fraud.weights, ...(req.body.fraud.weights || {}) } };
  writeSettings(s);
  res.json({ success: true, message: 'ML settings disimpan', data: getMlConfig(s) });
});

app.get('/api/admin/activity-risk', checkAdmin, (req, res) => {
  const users = readJSON('users.json');
  const merchants = readMerchants();
  const rows = [];
  (Array.isArray(users) ? users : []).forEach(u => {
    const r = scoreActor('user', u);
    rows.push({
      id: u.id, email: u.email, phone: u.phone || u.profile?.phone || '',
      type: 'Pengguna', risk: u.risk_score || r.risk, factors: u.risk_factors || r.factors,
      status: u.status || 'active'
    });
  });
  merchants.forEach(m => {
    const r = scoreActor('merchant', m);
    rows.push({
      id: m.id, email: m.email, phone: m.phone || '',
      type: 'Merchant', risk: m.risk_score || r.risk, factors: m.risk_factors || r.factors,
      status: m.status || 'pending'
    });
  });
  rows.sort((a, b) => Number(b.risk) - Number(a.risk));
  res.json({ success: true, data: rows });
});

app.post('/api/internal/risk-check', (req, res) => {
  // called after txs optionally
  const { actor_type, actor_id, device_id, location_key, account } = req.body || {};
  let actor = null;
  if (actor_type === 'merchant') actor = readMerchants().find(x => x.id === actor_id);
  else {
    const users = readJSON('users.json');
    actor = (Array.isArray(users) ? users : []).find(x => x.id === actor_id);
  }
  if (!actor) return res.status(404).json({ success: false });
  const settings = getSettings();
  const cfg = getMlConfig(settings);
  const r = evaluateRisk({
    txs: collectAllTxs(),
    actorId: actor_id,
    currentTx: { account },
    deviceId: device_id,
    knownDevices: actor.known_devices || [],
    locationKey: location_key,
    knownLocations: actor.known_locations || [],
    cfg
  });
  applyRiskActions(actor_type === 'merchant' ? 'merchant' : 'user', actor, r.risk, r.factors);
  // learn devices
  try {
    if (device_id) {
      if (actor_type === 'merchant') {
        const list = readMerchants();
        const i = list.findIndex(x => x.id === actor_id);
        if (i >= 0) {
          list[i].known_devices = Array.from(new Set([...(list[i].known_devices || []), device_id])).slice(-10);
          list[i].risk_score = r.risk;
          writeMerchants(list);
        }
      } else {
        const users = readJSON('users.json');
        const i = users.findIndex(x => x.id === actor_id);
        if (i >= 0) {
          users[i].known_devices = Array.from(new Set([...(users[i].known_devices || []), device_id])).slice(-10);
          users[i].risk_score = r.risk;
          writeJSON('users.json', users);
        }
      }
    }
  } catch (_) {}
  res.json({ success: true, data: r });
});


// SPA fallback — HARUS di paling akhir
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'API tidak ditemukan: ' + req.path });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('========================================');
  console.log(' bdPay PWA running at http://localhost:' + PORT);
  console.log(' Admin: /admin  (default admin / admin123)');
  console.log(' Merchant: /merchant  demo: merchant@demo.bdpay / demo123');
  console.log('========================================');
  setTimeout(() => {
    try {
      const _prods = readJSON('products.json') || [];
      getPriceCompare(_prods);
      console.log('[price-compare] daily cache ready');
    } catch (e) { console.warn('[price-compare]', e.message); }
    try {
      runApiMonitor(getSettings()).then(() => console.log('[api-monitor] initial run')).catch(e => console.warn('[api-monitor]', e.message));
      setInterval(() => {
        runApiMonitor(getSettings()).then(() => console.log('[api-monitor] periodic')).catch(() => {});
      }, 30 * 60 * 1000);
    } catch (e) { console.warn('[api-monitor] schedule', e.message); }
    try {
      const users = readJSON('users.json');
      let ch = false;
      users.forEach(u => {
        if ((u.username === 'demo' || u.email === 'demo@bdpay.local') && !u.pin_hash) {
          u.pin_hash = hashPin('123456');
          u.pin_set_at = new Date().toISOString();
          ch = true;
        }
      });
      if (ch) writeJSON('users.json', users);
      const merchants = readMerchants();
      let mch = false;
      merchants.forEach(m => {
        if ((m.email === 'merchant@demo.bdpay' || m.id === 'mch-demo-001') && !m.pin_hash) {
          m.pin_hash = hashPin('123456');
          m.pin_set_at = new Date().toISOString();
          mch = true;
        }
      });
      if (mch) writeMerchants(merchants);
    } catch (e) { console.warn('ensureDemoPins', e.message); }
  }, 100);
});
