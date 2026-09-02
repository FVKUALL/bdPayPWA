/**
 * Connection pooling — MongoDB / HTTP keep-alive / generic resource pool
 */
const http = require('http');
const https = require('https');

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 8, timeout: 60000 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 8, timeout: 60000 });

/** Pool generik untuk resource async (factory + max size) */
function createPool(factory, opts) {
  opts = opts || {};
  const max = opts.max || 5;
  const idle = [];
  let active = 0;
  const waiters = [];

  async function acquire() {
    if (idle.length) return idle.pop();
    if (active < max) {
      active += 1;
      try {
        return await factory();
      } catch (e) {
        active -= 1;
        throw e;
      }
    }
    return new Promise((resolve, reject) => {
      waiters.push({ resolve, reject });
    });
  }

  function release(resource) {
    if (waiters.length) {
      const w = waiters.shift();
      w.resolve(resource);
      return;
    }
    idle.push(resource);
  }

  async function withResource(fn) {
    const r = await acquire();
    try {
      return await fn(r);
    } finally {
      release(r);
    }
  }

  function stats() {
    return { max, active, idle: idle.length, waiting: waiters.length };
  }

  return { acquire, release, withResource, stats };
}

function getHttpAgent(url) {
  return String(url || '').startsWith('https') ? httpsAgent : httpAgent;
}

module.exports = { createPool, getHttpAgent, httpAgent, httpsAgent };
