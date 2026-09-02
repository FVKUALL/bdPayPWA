/**
 * JWT HS256 murni (Node crypto) — tanpa dependency eksternal
 * Payload: { sub, role: 'admin'|'merchant'|'user', ...claims, iat, exp }
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_FILE = path.join(__dirname, '..', '.jwt-secret');

function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  try {
    if (fs.existsSync(KEY_FILE)) return fs.readFileSync(KEY_FILE, 'utf8').trim();
  } catch (_) {}
  const s = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(KEY_FILE, s, { mode: 0o600 }); } catch (_) {}
  return s;
}

function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlJson(obj) {
  return b64url(JSON.stringify(obj));
}
function fromB64url(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, 'base64');
}

function signJwt(payload, opts) {
  opts = opts || {};
  const secret = opts.secret || getJwtSecret();
  const expSec = opts.expiresIn != null ? opts.expiresIn : 60 * 60 * 12; // 12 jam
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = Object.assign({}, payload, {
    iat: now,
    exp: now + expSec
  });
  const h = b64urlJson(header);
  const p = b64urlJson(body);
  const data = h + '.' + p;
  const sig = crypto.createHmac('sha256', secret).update(data).digest();
  return data + '.' + b64url(sig);
}

function verifyJwt(token, opts) {
  opts = opts || {};
  const secret = opts.secret || getJwtSecret();
  if (!token || typeof token !== 'string') return { ok: false, error: 'missing' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, error: 'format' };
  const [h, p, s] = parts;
  const data = h + '.' + p;
  const expected = b64url(crypto.createHmac('sha256', secret).update(data).digest());
  const a = Buffer.from(expected);
  const b = Buffer.from(s);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'signature' };
  }
  let payload;
  try {
    payload = JSON.parse(fromB64url(p).toString('utf8'));
  } catch (_) {
    return { ok: false, error: 'payload' };
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) return { ok: false, error: 'expired', payload };
  return { ok: true, payload };
}

function extractBearer(req) {
  const h = req.headers['authorization'] || req.headers['x-admin-auth'] || req.headers['x-merchant-auth'] || req.headers['x-user-auth'] || '';
  if (!h) return '';
  if (String(h).startsWith('Bearer ')) return String(h).slice(7).trim();
  return String(h).trim();
}

module.exports = { signJwt, verifyJwt, extractBearer, getJwtSecret };
