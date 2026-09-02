/**
 * Format JSON respons konsisten + status HTTP standar
 * {
 *   success: boolean,
 *   message?: string,
 *   data?: any,
 *   error?: { code, details },
 *   meta?: object
 * }
 */

const HttpStatus = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  TOO_MANY: 429,
  SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
};

function send(res, status, payload) {
  const body = {
    success: !!payload.success,
    message: payload.message != null ? String(payload.message) : undefined,
    data: payload.data !== undefined ? payload.data : undefined,
    error: payload.error || undefined,
    meta: payload.meta || undefined
  };
  // buang key undefined agar JSON bersih
  Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
  return res.status(status).json(body);
}

function ok(res, data, message, meta) {
  return send(res, HttpStatus.OK, { success: true, data, message, meta });
}
function created(res, data, message) {
  return send(res, HttpStatus.CREATED, { success: true, data, message });
}
function fail(res, status, message, errorCode, details) {
  return send(res, status, {
    success: false,
    message: message || 'Permintaan gagal',
    error: errorCode || details ? { code: errorCode || 'ERROR', details: details || undefined } : undefined
  });
}
function badRequest(res, message, details) {
  return fail(res, HttpStatus.BAD_REQUEST, message || 'Input tidak valid', 'BAD_REQUEST', details);
}
function unauthorized(res, message) {
  return fail(res, HttpStatus.UNAUTHORIZED, message || 'Unauthorized', 'UNAUTHORIZED');
}
function forbidden(res, message) {
  return fail(res, HttpStatus.FORBIDDEN, message || 'Forbidden', 'FORBIDDEN');
}
function notFound(res, message) {
  return fail(res, HttpStatus.NOT_FOUND, message || 'Tidak ditemukan', 'NOT_FOUND');
}
function tooMany(res, message, retryAfter) {
  if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
  return fail(res, HttpStatus.TOO_MANY, message || 'Terlalu banyak permintaan', 'RATE_LIMIT');
}
function serverError(res, message) {
  return fail(res, HttpStatus.SERVER_ERROR, message || 'Kesalahan server', 'SERVER_ERROR');
}

/** Express helper: bungkus async route agar error tertangkap */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = {
  HttpStatus,
  send,
  ok,
  created,
  fail,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  tooMany,
  serverError,
  asyncHandler
};
