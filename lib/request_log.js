/**
 * Middleware logging permintaan HTTP
 * - Console (dev-friendly)
 * - File ring buffer: data/request_logs.json
 * - Skip static assets by default
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOG_FILE = path.join(DATA_DIR, 'request_logs.json');
const MAX_ENTRIES = 500;

const SKIP_PREFIX = [
  '/css/', '/js/', '/img/', '/images/', '/fonts/', '/favicon',
  '/manifest', '/sw.js', '/icons/', '/merchant/css', '/merchant/js'
];
const SKIP_EXT = ['.css', '.js', '.map', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.webp'];

function ensureDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
}

function readLogs() {
  ensureDir();
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const raw = fs.readFileSync(LOG_FILE, 'utf8');
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j : [];
  } catch (_) {
    return [];
  }
}

function writeLogs(arr) {
  ensureDir();
  const tmp = LOG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(arr.slice(-MAX_ENTRIES), null, 2), 'utf8');
  fs.renameSync(tmp, LOG_FILE);
}

function shouldSkip(req) {
  const p = req.path || req.url || '';
  if (SKIP_PREFIX.some((x) => p.startsWith(x))) return true;
  const lower = p.toLowerCase();
  if (SKIP_EXT.some((ext) => lower.endsWith(ext))) return true;
  return false;
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || req.ip || '';
}

/**
 * requestLogMiddleware(options?)
 * options.getSettings?: () => settings
 * options.console?: boolean (default true)
 * options.persist?: boolean (default true)
 */
function requestLogMiddleware(options) {
  options = options || {};
  const getSettings = typeof options.getSettings === 'function' ? options.getSettings : null;

  return function requestLogger(req, res, next) {
    let enabled = true;
    let persist = options.persist !== false;
    let toConsole = options.console !== false;
    try {
      const st = getSettings ? getSettings() : {};
      const cfg = (st && st.request_log) || {};
      if (cfg.enabled === false) enabled = false;
      if (cfg.persist === false) persist = false;
      if (cfg.console === false) toConsole = false;
    } catch (_) {}

    if (!enabled || shouldSkip(req)) return next();

    const start = process.hrtime.bigint();
    const id = (crypto.randomUUID && crypto.randomUUID()) || crypto.randomBytes(8).toString('hex');
    req.requestId = id;
    res.setHeader('X-Request-Id', id);

    const meta = {
      id,
      method: req.method,
      path: req.path || req.url,
      query: req.query && Object.keys(req.query).length ? req.query : undefined,
      ip: clientIp(req),
      ua: String(req.headers['user-agent'] || '').slice(0, 180),
      at: new Date().toISOString()
    };

    const done = () => {
      res.removeListener('finish', done);
      res.removeListener('close', done);
      const ns = Number(process.hrtime.bigint() - start);
      const ms = Math.round(ns / 1e6);
      const entry = {
        ...meta,
        status: res.statusCode,
        duration_ms: ms,
        content_length: res.getHeader('content-length') || undefined
      };

      if (toConsole) {
        const q = entry.query ? '?' + new URLSearchParams(entry.query).toString() : '';
        console.log(
          `[REQ] ${entry.method} ${entry.path}${q} → ${entry.status} ${entry.duration_ms}ms ip=${entry.ip} id=${entry.id}`
        );
      }

      if (persist) {
        try {
          const logs = readLogs();
          logs.push(entry);
          writeLogs(logs);
        } catch (e) {
          console.warn('[request_log] persist failed:', e.message);
        }
      }
    };

    res.on('finish', done);
    res.on('close', done);
    next();
  };
}

function listRequestLogs(limit) {
  const n = Math.min(Number(limit) || 100, MAX_ENTRIES);
  const logs = readLogs();
  return logs.slice(-n).reverse();
}

function clearRequestLogs() {
  writeLogs([]);
  return true;
}

module.exports = {
  requestLogMiddleware,
  listRequestLogs,
  clearRequestLogs,
  readLogs,
  MAX_ENTRIES
};
