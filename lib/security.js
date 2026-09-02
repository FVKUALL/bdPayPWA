/**
 * Keamanan siber: rate limit, sanitasi, audit, security headers (+ HTTPS/HSTS dari settings)
 */
const crypto = require('crypto');
const { stripProto } = require('./validate');

const rateMap = new Map(); // key -> { count, reset }

function rateLimit(key, limitPerMin = 60) {
  const now = Date.now();
  let e = rateMap.get(key);
  if (!e || now > e.reset) {
    e = { count: 0, reset: now + 60_000 };
    rateMap.set(key, e);
  }
  e.count += 1;
  if (e.count > limitPerMin) {
    return { allowed: false, retry_after: Math.ceil((e.reset - now) / 1000), remaining: 0 };
  }
  return { allowed: true, remaining: Math.max(0, limitPerMin - e.count) };
}

/** Rate limit per route bucket (login lebih ketat) */
function rateLimitForRequest(req, settings) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const path = req.path || '';
  const sec = (settings && settings.security) || {};
  let limit = sec.rate_limit_per_minute || 120;
  let bucket = 'global:' + ip;
  if (/\/login|\/register|\/otp|\/pin\/verify/i.test(path)) {
    limit = sec.rate_limit_auth_per_minute || 20;
    bucket = 'auth:' + ip;
  } else if (/\/admin\//i.test(path)) {
    limit = sec.rate_limit_admin_per_minute || 180;
    bucket = 'admin:' + ip;
  } else if (/\/merchant\//i.test(path)) {
    limit = sec.rate_limit_merchant_per_minute || 120;
    bucket = 'merchant:' + ip;
  }
  const rl = rateLimit(bucket, limit);
  return { ...rl, ip, bucket, limit };
}

function sanitizeInput(obj, maxLen = 2000) {
  if (typeof obj === 'string') {
    return obj.replace(/[<>]/g, '').slice(0, maxLen);
  }
  if (Array.isArray(obj)) return obj.map(x => sanitizeInput(x, maxLen));
  if (obj && typeof obj === 'object') {
    const clean = stripProto(obj);
    const out = {};
    for (const [k, v] of Object.entries(clean)) {
      if (k === 'imageBase64' || k === 'credential' || k === 'image' || k === 'processed_image') {
        out[k] = typeof v === 'string' ? v.slice(0, 8_000_000) : v;
      } else {
        out[k] = sanitizeInput(v, maxLen);
      }
    }
    return out;
  }
  return obj;
}

function auditEntry({ action, actor, ip, detail, level = 'info' }) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
    ts: new Date().toISOString(),
    action,
    actor: actor || 'anonymous',
    ip: ip || '',
    level,
    detail: typeof detail === 'string' ? detail : JSON.stringify(detail || {}).slice(0, 2000)
  };
}

/**
 * securityHeaders(res, settings?)
 * HTTPS settings dari CMS: force_https, hsts_max_age, hsts_preload
 */
function securityHeaders(res, settings) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self)');
  res.setHeader('X-XSS-Protection', '0');
  const httpsCfg = (settings && (settings.https || settings.cms?.https)) || {};
  if (httpsCfg.hsts !== false && (httpsCfg.force_https || httpsCfg.hsts_max_age)) {
    const maxAge = Number(httpsCfg.hsts_max_age) || 31536000;
    let hsts = 'max-age=' + maxAge;
    if (httpsCfg.hsts_include_subdomains !== false) hsts += '; includeSubDomains';
    if (httpsCfg.hsts_preload) hsts += '; preload';
    res.setHeader('Strict-Transport-Security', hsts);
  }
  if (httpsCfg.content_security_policy) {
    res.setHeader('Content-Security-Policy', String(httpsCfg.content_security_policy));
  }
}

/** Redirect HTTP → HTTPS jika force_https + X-Forwarded-Proto */
function httpsRedirectMiddleware(getSettingsFn) {
  return (req, res, next) => {
    try {
      const st = typeof getSettingsFn === 'function' ? getSettingsFn() : {};
      const httpsCfg = st.https || st.cms?.https || {};
      if (!httpsCfg.force_https) return next();
      const proto = String(req.headers['x-forwarded-proto'] || req.protocol || '').toLowerCase();
      if (proto && proto !== 'https') {
        const host = req.headers.host || 'localhost';
        return res.redirect(301, 'https://' + host + req.originalUrl);
      }
    } catch (_) {}
    next();
  };
}

module.exports = {
  rateLimit,
  rateLimitForRequest,
  sanitizeInput,
  auditEntry,
  securityHeaders,
  httpsRedirectMiddleware
};
