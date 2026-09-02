/**
 * AI provider router with priority switching (live).
 * Priority default:
 * OpenAI → Grok xAI → Gemini → Groq → Google AI Studio → DeepSeek → Qwen Alibaba → other
 */
const DEFAULT_PRIORITY = [
  'openai',
  'grok',
  'gemini',
  'groq',
  'google_ai_studio',
  'deepseek',
  'qwen',
  'other'
];

const { logAIActivity } = require('./ai_activity');

/** Shared OpenAI-compatible chat completions caller */
async function callOpenAICompatible(providerId, conf, messages, defaults = {}) {
  if (!conf?.api_key) throw new Error(providerId + ' api_key kosong');
  const base = (conf.base_url || defaults.base_url || '').replace(/\/$/, '');
  if (!base) throw new Error(providerId + ' base_url kosong');
  const url = base.includes('/chat/completions') ? base : base + '/chat/completions';
  const body = {
    model: conf.model || defaults.model || 'gpt-4o-mini',
    messages,
    temperature: conf.temperature != null ? conf.temperature : 0.4,
    max_tokens: conf.max_tokens || defaults.max_tokens || 800
  };
  const headers = {
    Authorization: 'Bearer ' + conf.api_key,
    'Content-Type': 'application/json',
    ...(conf.headers || {})
  };
  // Qwen / DashScope sometimes use alternate header
  if (providerId === 'qwen' && conf.use_dashscope_header) {
    headers.Authorization = 'Bearer ' + conf.api_key;
  }
  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(j.error?.message || j.message || (providerId + ' HTTP ' + r.status));
  }
  const text =
    j.choices?.[0]?.message?.content ||
    j.choices?.[0]?.text ||
    j.output?.text ||
    j.text ||
    '';
  return { provider: providerId, text: String(text || ''), raw: j, model: body.model };
}

async function callOpenAI(conf, messages) {
  return callOpenAICompatible('openai', conf, messages, {
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini'
  });
}

async function callGrok(conf, messages) {
  return callOpenAICompatible('grok', conf, messages, {
    base_url: 'https://api.x.ai/v1',
    model: 'grok-3-mini'
  });
}

async function callGroq(conf, messages) {
  // Groq OpenAI-compatible API
  return callOpenAICompatible('groq', conf, messages, {
    base_url: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-20b'
  });
}

async function callDeepseek(conf, messages) {
  return callOpenAICompatible('deepseek', conf, messages, {
    base_url: 'https://api.deepseek.com',
    model: 'deepseek-chat'
  });
}

async function callQwen(conf, messages) {
  // Alibaba Cloud DashScope OpenAI-compatible endpoint
  return callOpenAICompatible('qwen', conf, messages, {
    base_url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus'
  });
}

async function callGemini(conf, messages) {
  if (!conf?.api_key) throw new Error('Gemini api_key kosong');
  const models = [conf.model, 'gemini-3.6-flash', 'gemini-2.0-flash', 'gemini-2.5-flash'].filter(Boolean);
  const base = (conf.base_url || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
  let contents2;
  if (messages[0] && messages[0].role === 'system') {
    const sys = messages[0].content;
    const rest = messages.slice(1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
    if (rest.length) rest[0].parts[0].text = sys + '\n\n' + rest[0].parts[0].text;
    else rest.push({ role: 'user', parts: [{ text: sys }] });
    contents2 = rest;
  } else {
    contents2 = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
  }
  let lastErr = 'Gemini error';
  for (const model of models) {
    try {
      const url = base + '/models/' + model + ':generateContent?key=' + encodeURIComponent(conf.api_key);
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: contents2 })
      });
      const j = await r.json();
      if (!r.ok) {
        lastErr = j.error?.message || ('Gemini ' + model + ' HTTP ' + r.status);
        continue;
      }
      const text = j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
      return { provider: 'gemini', text, raw: j, model };
    } catch (e) {
      lastErr = e.message || String(e);
    }
  }
  throw new Error(lastErr);
}

/**
 * Google AI Studio — same Generative Language API as Gemini, separate key/config slot.
 * Docs: https://aistudio.google.com/ → API key
 */
async function callGoogleAIStudio(conf, messages) {
  if (!conf?.api_key) throw new Error('Google AI Studio api_key kosong');
  // Reuse Gemini protocol with studio defaults
  return callGemini(
    {
      ...conf,
      model: conf.model || 'gemini-3.6-flash',
      base_url: conf.base_url || 'https://generativelanguage.googleapis.com/v1beta'
    },
    messages
  ).then(r => ({ ...r, provider: 'google_ai_studio' }));
}

async function callOther(conf, messages) {
  if (!conf?.api_key || !conf?.base_url) throw new Error('Other AI base_url/api_key kosong');
  return callOpenAICompatible('other', conf, messages, {
    base_url: conf.base_url,
    model: conf.model || 'default'
  });
}

const PROVIDER_IDS = [
  'openai',
  'grok',
  'gemini',
  'groq',
  'google_ai_studio',
  'deepseek',
  'qwen',
  'other'
];

function buildCallers(ai, messages) {
  return {
    openai: () => callOpenAI(ai.providers?.openai || {}, messages),
    grok: () => callGrok(ai.providers?.grok || {}, messages),
    gemini: () => callGemini(ai.providers?.gemini || {}, messages),
    groq: () => callGroq(ai.providers?.groq || {}, messages),
    google_ai_studio: () => callGoogleAIStudio(ai.providers?.google_ai_studio || {}, messages),
    deepseek: () => callDeepseek(ai.providers?.deepseek || {}, messages),
    qwen: () => callQwen(ai.providers?.qwen || {}, messages),
    other: () => callOther(ai.providers?.other || {}, messages)
  };
}

function hasAnyLiveKey(ai) {
  return PROVIDER_IDS.some(k => ai.providers?.[k]?.api_key && ai.providers?.[k]?.enabled !== false);
}

async function runAI(settings, task, userPrompt, systemPrompt) {
  const ai = settings?.ai || {};
  const t0 = Date.now();
  const logBase = {
    task: task || 'general',
    prompt_preview: String(userPrompt || '').slice(0, 240),
    system_preview: String(systemPrompt || '').slice(0, 120)
  };
  if (ai.enabled === false) {
    const out = { success: false, message: 'AI dinonaktifkan di setting', simulation: true };
    try { logAIActivity({ ...logBase, ...out, duration_ms: Date.now() - t0 }); } catch (_) {}
    return out;
  }
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: '[' + task + ']\n' + userPrompt });

  const priority = Array.isArray(ai.priority) && ai.priority.length ? ai.priority : DEFAULT_PRIORITY;
  const allowParallel = !!ai.run_parallel;
  const tried = [];
  const errors = [];
  const callers = buildCallers(ai, messages);

  const finish = (out) => {
    try {
      logAIActivity({
        ...logBase,
        success: !!out.success,
        simulation: !!out.simulation,
        provider: out.provider || null,
        tried: out.tried || [],
        message: out.message || null,
        text_preview: String(out.text || '').slice(0, 400),
        duration_ms: Date.now() - t0
      });
    } catch (_) {}
    return out;
  };

  if (!hasAnyLiveKey(ai)) {
    return finish({
      success: true,
      simulation: true,
      provider: 'simulation',
      text:
        '[Simulasi AI] Task: ' + task + '\n' +
        'Prompt diterima. Aktifkan API key di Admin → AI Provider untuk jawaban live.\n' +
        'Provider: OpenAI, Grok xAI, Gemini, Groq, Google AI Studio, DeepSeek, Qwen.\n' +
        'Ringkasan: ' + String(userPrompt).slice(0, 280),
      tried: []
    });
  }

  if (allowParallel) {
    const jobs = priority
      .filter(p => callers[p] && ai.providers?.[p]?.enabled !== false && ai.providers?.[p]?.api_key)
      .map(async p => {
        try {
          const r = await callers[p]();
          return { ok: true, p, r };
        } catch (e) {
          return { ok: false, p, err: e.message };
        }
      });
    const results = await Promise.all(jobs);
    const ok = results.find(x => x.ok);
    results.forEach(x => {
      tried.push(x.p);
      if (!x.ok) errors.push(x.p + ': ' + x.err);
    });
    if (ok) return finish({ success: true, ...ok.r, tried, errors });
    return finish({ success: false, message: errors.join(' | ') || 'Semua AI gagal', tried, simulation: false });
  }

  for (const p of priority) {
    const conf = ai.providers?.[p];
    if (!callers[p] || !conf || conf.enabled === false || !conf.api_key) continue;
    tried.push(p);
    try {
      const r = await callers[p]();
      return finish({ success: true, ...r, tried });
    } catch (e) {
      errors.push(p + ': ' + e.message);
    }
  }
  return finish({
    success: false,
    message: errors.join(' | ') || 'Tidak ada provider AI aktif',
    tried,
    simulation: false
  });
}

/** Cyber defense helper suggestions */
async function aiCyberAction(settings, event) {
  const prompt =
    'Analisis keamanan siber untuk event berikut dan sarankan: block_ip, whitelist, blacklist, captcha, atau ignore. Jawab JSON {action, reason, risk:1-5}.\n' +
    JSON.stringify(event);
  return runAI(
    settings,
    'cyber_defense',
    prompt,
    'Anda adalah sistem keamanan bdPay. Output hanya JSON valid.'
  );
}

module.exports = {
  runAI,
  aiCyberAction,
  DEFAULT_PRIORITY,
  PROVIDER_IDS
};
