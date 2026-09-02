/**
 * Unique captcha challenges (in-memory + optional file backup)
 */
const crypto = require('crypto');
const store = new Map(); // id -> { answer, exp, used }

const TTL_MS = 5 * 60 * 1000;

function cleanup() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.exp < now || v.used) store.delete(k);
  }
}

function createCaptcha() {
  cleanup();
  const id = crypto.randomBytes(12).toString('hex');
  // Math captcha (unique operands)
  const a = 2 + Math.floor(Math.random() * 18);
  const b = 1 + Math.floor(Math.random() * 12);
  const ops = ['+', '-', '×'];
  const op = ops[Math.floor(Math.random() * ops.length)];
  let answer;
  if (op === '+') answer = a + b;
  else if (op === '-') answer = a - b;
  else answer = a * b;
  // Character code mix for display uniqueness
  const noise = crypto.randomBytes(2).toString('hex').toUpperCase();
  const question = `${a} ${op} ${b}`;
  const display = `${question}  ·  ${noise}`;
  store.set(id, { answer: String(answer), exp: Date.now() + TTL_MS, used: false });
  return { captcha_id: id, question, display, expires_in: TTL_MS / 1000 };
}

function verifyCaptcha(id, userAnswer) {
  cleanup();
  if (!id || userAnswer === undefined || userAnswer === null) return { ok: false, message: 'Captcha wajib diisi' };
  const row = store.get(String(id));
  if (!row) return { ok: false, message: 'Captcha kedaluwarsa, muat ulang' };
  if (row.used) return { ok: false, message: 'Captcha sudah dipakai' };
  if (row.exp < Date.now()) {
    store.delete(String(id));
    return { ok: false, message: 'Captcha kedaluwarsa, muat ulang' };
  }
  const ans = String(userAnswer).trim();
  if (ans !== row.answer) return { ok: false, message: 'Jawaban captcha salah' };
  row.used = true;
  store.delete(String(id));
  return { ok: true };
}

module.exports = { createCaptcha, verifyCaptcha };
