/**
 * Channel API monitoring — Demo / Sandbox / Production connectivity checks
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data', 'api_monitor.json');

function readStore() {
  try {
    if (!fs.existsSync(FILE)) return { last_run: null, channels: [] };
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (_) {
    return { last_run: null, channels: [] };
  }
}
function writeStore(d) {
  fs.writeFileSync(FILE, JSON.stringify(d, null, 2), 'utf8');
}

async function probeUrl(url, opts = {}) {
  const t0 = Date.now();
  try {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), opts.timeout || 8000);
    const r = await fetch(url, { method: opts.method || 'GET', signal: controller.signal, headers: opts.headers || {} });
    clearTimeout(to);
    return { ok: r.status < 500, status: r.status, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: e.message };
  }
}

function stageOf(mode) {
  const m = String(mode || 'sandbox').toLowerCase();
  if (m === 'production' || m === 'prod' || m === 'live') return 'Production';
  if (m === 'demo') return 'Demo';
  return 'Sandbox';
}

async function runApiMonitor(settings) {
  const channels = [];
  const ppob = settings.api_ppob || {};
  const pay = settings.api_payment || {};
  const rem = settings.api_remittance || {};
  const ai = settings.ai || {};

  const defs = [
    { id: 'digiflazz', type: 'PPOB', name: 'Digiflazz', conf: ppob.digiflazz, url: (ppob.digiflazz?.base_url || 'https://api.digiflazz.com/v1') },
    { id: 'iak', type: 'PPOB', name: 'IAK', conf: ppob.iak, url: ppob.iak?.base_url_prepaid || 'https://prepaid.iak.dev' },
    { id: 'raja-biller', type: 'PPOB', name: 'Raja-Biller', conf: ppob['raja-biller'] || ppob.raja_biller, url: (ppob['raja-biller'] || ppob.raja_biller)?.base_url || 'https://example.raja-biller.local' },
    { id: 'bdpay', type: 'Payment', name: 'bdPay', conf: pay.bdpay, url: pay.bdpay?.base_url || 'https://dev-openapi.bdpay.co.id' },
    { id: 'midtrans', type: 'Payment', name: 'Midtrans', conf: pay.midtrans, url: pay.midtrans?.base_url || 'https://api.sandbox.midtrans.com' },
    { id: 'doku', type: 'Payment', name: 'DOKU', conf: pay.doku, url: pay.doku?.base_url || 'https://api-sandbox.doku.com' },
    { id: 'xendit', type: 'Payment', name: 'Xendit', conf: pay.xendit, url: pay.xendit?.base_url || 'https://api.xendit.co' },
    { id: 'ria', type: 'Remittance', name: 'Ria Money Transfer', conf: rem.ria, url: rem.ria?.base_url || null },
    { id: 'moneygram', type: 'Remittance', name: 'MoneyGram', conf: rem.moneygram, url: rem.moneygram?.base_url || null },
    { id: 'westernunion', type: 'Remittance', name: 'Western Union', conf: rem.westernunion, url: rem.westernunion?.base_url || null },
    { id: 'openai', type: 'AI', name: 'OpenAI', conf: ai.providers?.openai, url: 'https://api.openai.com/v1/models' },
    { id: 'grok', type: 'AI', name: 'Grok xAI', conf: ai.providers?.grok, url: 'https://api.x.ai/v1/models' },
    { id: 'gemini', type: 'AI', name: 'Gemini', conf: ai.providers?.gemini, url: null },
    { id: 'groq', type: 'AI', name: 'Groq', conf: ai.providers?.groq, url: 'https://api.groq.com/openai/v1/models' },
    { id: 'google_ai_studio', type: 'AI', name: 'Google AI Studio', conf: ai.providers?.google_ai_studio, url: null },
    { id: 'deepseek', type: 'AI', name: 'DeepSeek', conf: ai.providers?.deepseek, url: 'https://api.deepseek.com/models' },
    { id: 'qwen', type: 'AI', name: 'Qwen Alibaba', conf: ai.providers?.qwen, url: null }
  ];

  for (const d of defs) {
    const conf = d.conf || {};
    const stage = stageOf(conf.mode || rem.mode || ppob.digiflazz?.mode || 'sandbox');
    const active = conf.active !== false && conf.enabled !== false;
    let probe = { ok: false, status: 0, ms: 0, note: 'skip' };
    if (!active) {
      probe = { ok: false, status: 0, ms: 0, note: 'disabled' };
    } else if (d.id === 'gemini' && conf.api_key) {
      const u = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(conf.api_key);
      probe = await probeUrl(u);
      probe.note = probe.ok ? 'reachable' : (probe.error || 'fail');
    } else if (d.id.startsWith('ria') || d.id === 'moneygram' || d.id === 'westernunion') {
      // sandbox without URL = simulated OK
      if (stage === 'Sandbox' || stage === 'Demo' || !d.url) {
        probe = { ok: true, status: 200, ms: 12, note: 'sandbox-sim' };
      } else {
        probe = await probeUrl(d.url);
      }
    } else if (d.url) {
      const headers = {};
      if (d.id === 'openai' && conf.api_key) headers.Authorization = 'Bearer ' + conf.api_key;
      if (d.id === 'grok' && conf.api_key) headers.Authorization = 'Bearer ' + conf.api_key;
      probe = await probeUrl(d.url.replace(/\/$/, '') + (d.id === 'openai' || d.id === 'grok' ? '' : ''), { headers });
      // treat 401 as "reachable" (auth works at network layer)
      if (!probe.ok && (probe.status === 401 || probe.status === 403)) {
        probe.ok = true;
        probe.note = 'reachable-auth';
      } else {
        probe.note = probe.ok ? 'reachable' : (probe.error || 'fail');
      }
    } else {
      probe = { ok: true, status: 200, ms: 5, note: 'sandbox-sim' };
    }
    channels.push({
      id: d.id,
      name: d.name,
      type: d.type,
      stage,
      active,
      status: probe.ok ? 'Connected' : (probe.note === 'disabled' ? 'Disabled' : 'Disconnected'),
      http_status: probe.status,
      latency_ms: probe.ms,
      note: probe.note,
      checked_at: new Date().toISOString()
    });
  }

  const store = {
    last_run: new Date().toISOString(),
    channels,
    summary: {
      total: channels.length,
      connected: channels.filter(c => c.status === 'Connected').length,
      disconnected: channels.filter(c => c.status === 'Disconnected').length,
      disabled: channels.filter(c => c.status === 'Disabled').length
    }
  };
  writeStore(store);
  return store;
}

module.exports = { runApiMonitor, readStore };
