/**
 * Validasi & sanitasi input — server-side
 */

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}
function isNik(s) {
  return /^\d{16}$/.test(String(s || '').replace(/\D/g, ''));
}
function isPin6(s) {
  return /^\d{6}$/.test(String(s || ''));
}
function isPhoneId(s) {
  const d = String(s || '').replace(/\D/g, '');
  return d.length >= 10 && d.length <= 15;
}
function clampStr(s, max) {
  return String(s == null ? '' : s).trim().slice(0, max || 500);
}
function toInt(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : (def != null ? def : 0);
}
function toAmount(v) {
  if (typeof v === 'number') return Math.max(0, Math.round(v));
  const n = Number(String(v || '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

/** Hapus prototype pollution keys */
function stripProto(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripProto);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = typeof v === 'object' && v !== null ? stripProto(v) : v;
  }
  return out;
}

function validateFields(body, rules) {
  const errors = [];
  const data = {};
  for (const [field, rule] of Object.entries(rules || {})) {
    let val = body && body[field];
    if (rule.trim && typeof val === 'string') val = val.trim();
    if (rule.required && (val == null || val === '')) {
      errors.push({ field, message: rule.message || (field + ' wajib') });
      continue;
    }
    if (val == null || val === '') {
      if (rule.default !== undefined) data[field] = rule.default;
      continue;
    }
    if (rule.type === 'email' && !isEmail(val)) errors.push({ field, message: 'Email tidak valid' });
    if (rule.type === 'nik' && !isNik(val)) errors.push({ field, message: 'NIK harus 16 digit' });
    if (rule.type === 'pin' && !isPin6(val)) errors.push({ field, message: 'PIN harus 6 digit' });
    if (rule.type === 'phone' && !isPhoneId(val)) errors.push({ field, message: 'Nomor telepon tidak valid' });
    if (rule.type === 'amount') val = toAmount(val);
    if (rule.type === 'int') val = toInt(val, rule.default);
    if (rule.maxLen && String(val).length > rule.maxLen) {
      errors.push({ field, message: 'Terlalu panjang (max ' + rule.maxLen + ')' });
    }
    if (rule.enum && !rule.enum.includes(val)) {
      errors.push({ field, message: 'Nilai tidak diizinkan' });
    }
    data[field] = val;
  }
  return { ok: errors.length === 0, errors, data };
}

module.exports = {
  isEmail, isNik, isPin6, isPhoneId, clampStr, toInt, toAmount, stripProto, validateFields
};
