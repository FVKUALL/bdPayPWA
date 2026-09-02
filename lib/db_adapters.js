/**
 * Multi-database adapter layer for bdPay.
 * Backends: json (default), lowdb, mongodb, supabase
 * Feature → backend mapping is controlled from Admin settings.databases.feature_map
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOWDB_DIR = path.join(DATA_DIR, 'lowdb');

function ensureDir(d) {
  try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
}

function readJsonFile(name) {
  const fp = path.join(DATA_DIR, name);
  if (!fs.existsSync(fp)) return null;
  try {
    const raw = fs.readFileSync(fp, 'utf8');
    if (raw.startsWith('ENC:')) return null; // encrypted handled by server readJSON
    return JSON.parse(raw);
  } catch (_) { return null; }
}

function writeJsonFile(name, data) {
  ensureDir(DATA_DIR);
  const fp = path.join(DATA_DIR, name);
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, fp);
}

/* —— Lowdb-style simple JSON collection (no external dep required) —— */
function lowdbPath(collection) {
  ensureDir(LOWDB_DIR);
  return path.join(LOWDB_DIR, collection + '.json');
}
function lowdbRead(collection) {
  const fp = lowdbPath(collection);
  if (!fs.existsSync(fp)) return [];
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (_) { return []; }
}
function lowdbWrite(collection, arr) {
  fs.writeFileSync(lowdbPath(collection), JSON.stringify(arr, null, 2), 'utf8');
}

/* —— MongoDB Atlas (optional, native driver if installed) —— */
let mongoClient = null;
async function getMongo(settings) {
  const conf = settings?.databases?.mongodb || {};
  if (!conf.enabled || !conf.uri) return null;
  try {
    const { MongoClient } = require('mongodb');
    if (!mongoClient) {
      mongoClient = new MongoClient(conf.uri, { maxPoolSize: conf.pool_size || 10, minPoolSize: conf.min_pool || 0, maxIdleTimeMS: 30000 });
      await mongoClient.connect();
    }
    return mongoClient.db(conf.db_name || 'bdpay');
  } catch (e) {
    console.warn('[db] mongodb unavailable:', e.message);
    return null;
  }
}

/* —— Supabase (optional REST) —— */
async function supabaseRequest(settings, table, method, body, query) {
  const conf = settings?.databases?.supabase || {};
  if (!conf.enabled || !conf.url || !conf.service_key) return null;
  try {
    const url = conf.url.replace(/\/$/, '') + '/rest/v1/' + table + (query || '');
    const r = await fetch(url, {
      method,
      headers: {
        apikey: conf.service_key,
        Authorization: 'Bearer ' + conf.service_key,
        'Content-Type': 'application/json',
        Prefer: method === 'POST' ? 'return=representation' : 'return=minimal'
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!r.ok) throw new Error('supabase ' + r.status);
    const text = await r.text();
    return text ? JSON.parse(text) : true;
  } catch (e) {
    console.warn('[db] supabase:', e.message);
    return null;
  }
}

const DEFAULT_FEATURE_MAP = {
  cms_seo: 'json',
  photos_images: 'lowdb',
  audit: 'json',
  password_token: 'json',
  transaksi_laporan: 'lowdb',
  panduan_pengguna: 'lowdb',
  merchants: 'json',
  users: 'json',
  products: 'json',
  otp: 'json',
  messages: 'json',
  i18n: 'json'
};

function resolveBackend(settings, feature) {
  const map = (settings && settings.databases && settings.databases.feature_map) || DEFAULT_FEATURE_MAP;
  const backends = settings?.databases || {};
  let be = map[feature] || 'json';
  if (be === 'lowdb' && backends.lowdb && backends.lowdb.enabled === false) be = 'json';
  if (be === 'mongodb' && !(backends.mongodb && backends.mongodb.enabled)) be = 'json';
  if (be === 'supabase' && !(backends.supabase && backends.supabase.enabled)) be = 'json';
  return be;
}

/**
 * Generic collection ops used by features.
 * collection names map to JSON filenames or lowdb files.
 */
async function dbGetAll(settings, feature, collection) {
  const be = resolveBackend(settings, feature);
  if (be === 'lowdb') return lowdbRead(collection);
  if (be === 'mongodb') {
    const db = await getMongo(settings);
    if (db) return await db.collection(collection).find({}).toArray();
  }
  if (be === 'supabase') {
    const rows = await supabaseRequest(settings, collection, 'GET');
    if (Array.isArray(rows)) return rows;
  }
  // json default — caller should use server readJSON; here fallback file
  const data = readJsonFile(collection + '.json');
  return Array.isArray(data) ? data : (data || []);
}

async function dbSaveAll(settings, feature, collection, data) {
  const be = resolveBackend(settings, feature);
  if (be === 'lowdb') { lowdbWrite(collection, data); return { backend: 'lowdb' }; }
  if (be === 'mongodb') {
    const db = await getMongo(settings);
    if (db) {
      await db.collection(collection).deleteMany({});
      if (Array.isArray(data) && data.length) await db.collection(collection).insertMany(data);
      return { backend: 'mongodb' };
    }
  }
  if (be === 'supabase') {
    // best-effort upsert not implemented fully — store snapshot in lowdb as cache
    lowdbWrite(collection + '_supabase_cache', data);
    return { backend: 'supabase', note: 'cached locally; configure table RLS for production' };
  }
  writeJsonFile(collection + '.json', data);
  return { backend: 'json' };
}

async function dbSaveMediaMeta(settings, meta) {
  // photos_images feature
  const be = resolveBackend(settings, 'photos_images');
  const list = await dbGetAll(settings, 'photos_images', 'media_index');
  const arr = Array.isArray(list) ? list : [];
  arr.push({ ...meta, at: new Date().toISOString() });
  if (arr.length > 5000) arr.splice(0, arr.length - 5000);
  return dbSaveAll(settings, 'photos_images', 'media_index', arr);
}

module.exports = {
  DEFAULT_FEATURE_MAP,
  resolveBackend,
  dbGetAll,
  dbSaveAll,
  dbSaveMediaMeta,
  lowdbRead,
  lowdbWrite,
  getMongo
};
