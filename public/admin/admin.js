/**
 * bdPay Admin Panel
 */
const API = '/api';
let adminToken = sessionStorage.getItem('admin_token') || '';

function authHeaders() {
  return { 'Content-Type': 'application/json', 'X-Admin-Auth': adminToken };
}
function adminHeaders() { return authHeaders(); }

function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
}
function esc(s) { return escHtml(s); }
async function adminJson(url, opts) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); }
  catch (e) {
    const snippet = text.slice(0, 80).replace(/\s+/g, ' ');
    throw new Error('API mengembalikan non-JSON (' + r.status + '): ' + snippet + ' — restart server Node.js');
  }
  if (!r.ok && j && j.message) throw new Error(j.message);
  return j;
}



/* —— Table tools (search / sort / paging) —— */
window.__tableCache = window.__tableCache || {};

function bindTableTools(searchId, sortId, cacheKey, renderFn, pageSizeId, pageId) {
  const wire = (id, ev, fn) => {
    const el = document.getElementById(id);
    if (!el || el.dataset.boundTable === '1') return;
    el.dataset.boundTable = '1';
    el.addEventListener(ev, fn);
  };
  const run = () => applyTableFilterSort(cacheKey, searchId, sortId, renderFn, pageSizeId, pageId);
  wire(searchId, 'input', run);
  wire(sortId, 'change', run);
  wire(pageSizeId, 'change', () => {
    const p = document.getElementById(pageId);
    if (p) p.value = '1';
    run();
  });
  // pager buttons use data-page
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-page][data-pager="' + cacheKey + '"]');
    if (!b) return;
    const p = document.getElementById(pageId);
    if (p) p.value = b.getAttribute('data-page');
    run();
  });
}

function applyTableFilterSort(cacheKey, searchId, sortId, renderFn, pageSizeId, pageId) {
  let list = (window.__tableCache && window.__tableCache[cacheKey]) ? window.__tableCache[cacheKey].slice() : [];
  const q = (document.getElementById(searchId)?.value || '').trim().toLowerCase();
  const sort = document.getElementById(sortId)?.value || '';
  if (q) {
    list = list.filter(row => JSON.stringify(row).toLowerCase().includes(q));
  }
  if (sort) {
    let desc = sort.startsWith('-') || /_desc$/.test(sort);
    let key = sort.replace(/^[-]/, '').replace(/_desc$|_asc$/, '');
    if (sort === 'date_desc' || sort === 'date_asc') { key = 'created_at'; desc = sort.endsWith('desc'); }
    if (sort === 'amount_desc' || sort === 'amount_asc') { key = 'amount'; desc = sort.endsWith('desc'); }
    if (key === 'date') key = 'created_at';
    if (key === 'nominal') key = 'amount';
    list.sort((a, b) => {
      let va = a[key] != null ? a[key] : (a.date || a.total || a.nominal);
      let vb = b[key] != null ? b[key] : (b.date || b.total || b.nominal);
      if (key === 'created_at' || key === 'date') {
        va = Date.parse(a.created_at || a.date || 0) || 0;
        vb = Date.parse(b.created_at || b.date || 0) || 0;
      } else if (key === 'amount' || key === 'total' || key === 'nominal') {
        va = Number(a.amount != null ? a.amount : (a.total != null ? a.total : a.nominal)) || 0;
        vb = Number(b.amount != null ? b.amount : (b.total != null ? b.total : b.nominal)) || 0;
      } else if (typeof va === 'string') {
        va = va.toLowerCase(); vb = String(vb || '').toLowerCase();
      } else {
        va = Number(va) || 0; vb = Number(vb) || 0;
      }
      if (va < vb) return desc ? 1 : -1;
      if (va > vb) return desc ? -1 : 1;
      return 0;
    });
  }
  const size = Math.max(1, Number(document.getElementById(pageSizeId)?.value) || 10);
  let page = Math.max(1, Number(document.getElementById(pageId)?.value) || 1);
  const pages = Math.max(1, Math.ceil(list.length / size));
  if (page > pages) page = pages;
  const pEl = document.getElementById(pageId);
  if (pEl) pEl.value = String(page);
  const slice = list.slice((page - 1) * size, page * size);
  try { renderFn(slice, { total: list.length, page, pages, size }); } catch (e) { console.error(e); }
  // optional pager container
  const pager = document.getElementById(pageId + '-btns') || document.querySelector('[data-pager-box="' + cacheKey + '"]');
  if (pager) {
    let html = '<span style="font-size:.8rem;color:#64748b;margin-right:8px">' + list.length + ' baris · ' + page + '/' + pages + '</span>';
    for (let i = 1; i <= pages && i <= 15; i++) {
      html += '<button type="button" class="btn btn-sm ' + (i === page ? 'btn-primary' : 'btn-outline') + '" data-pager="' + cacheKey + '" data-page="' + i + '">' + i + '</button> ';
    }
    pager.innerHTML = html;
  }
}

function bindTableControls(opts) {
  // compatibility alias used by reports-v2
  if (!opts) return;
  bindTableTools(opts.searchId, opts.sortId, opts.cacheKey, opts.render, opts.pageSizeId, opts.pageId);
  applyTableFilterSort(opts.cacheKey, opts.searchId, opts.sortId, opts.render, opts.pageSizeId, opts.pageId);
}


function adminToast(message, type, ms) {
  type = type || 'info'; ms = ms || 3500;
  let box = document.getElementById('admin-toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'admin-toast';
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = 'toast-item ' + type;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function adminConfirm(message) {
  return new Promise((resolve) => {
    let ov = document.getElementById('confirm-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'confirm-overlay';
      ov.className = 'modal-overlay';
      ov.innerHTML = '<div class="modal-box"><p id="confirm-msg" style="margin:0 0 16px"></p><div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn-outline" id="confirm-cancel">Batal</button><button type="button" class="btn btn-primary" id="confirm-ok">OK</button></div></div>';
      document.body.appendChild(ov);
    }
    ov.classList.remove('hidden');
    document.getElementById('confirm-msg').textContent = message;
    const ok = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');
    const done = (v) => { ov.classList.add('hidden'); ok.onclick = null; cancel.onclick = null; resolve(v); };
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
  });
}

function adminPrompt(title, defaultVal) {
  return new Promise((resolve) => {
    let ov = document.getElementById('prompt-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'prompt-overlay';
      ov.className = 'modal-overlay';
      ov.innerHTML = '<div class="modal-box"><p id="prompt-title" style="margin:0 0 8px;font-weight:600"></p><input type="text" id="prompt-input" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;box-sizing:border-box;margin-bottom:12px"><div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn-outline" id="prompt-cancel">Batal</button><button type="button" class="btn btn-primary" id="prompt-ok">OK</button></div></div>';
      document.body.appendChild(ov);
    }
    ov.classList.remove('hidden');
    document.getElementById('prompt-title').textContent = title;
    const inp = document.getElementById('prompt-input');
    inp.value = defaultVal || '';
    setTimeout(() => inp.focus(), 50);
    const ok = document.getElementById('prompt-ok');
    const cancel = document.getElementById('prompt-cancel');
    const done = (v) => { ov.classList.add('hidden'); ok.onclick = null; cancel.onclick = null; resolve(v); };
    ok.onclick = () => done(inp.value);
    cancel.onclick = () => done(null);
    inp.onkeydown = (e) => { if (e.key === 'Enter') done(inp.value); };
  });
}


const PAGE_META = {
  dashboard: { title: 'Dashboard', desc: 'Ringkasan sistem bdPay: pengguna, produk, dan transaksi.' },
  'products-api': { title: 'PPOB API Provider', desc: 'Muat katalog provider dan aktifkan produk ke katalog jual.' },
  products: { title: 'Produk', desc: 'Kelola produk PPOB prabayar dan pascabayar. Aktif/nonaktifkan SKU.' },
  faqs: { title: 'FAQ', desc: 'Pertanyaan yang sering diajukan di halaman pengguna.' },
  settings: { title: 'API & Settings', desc: 'Konfigurasi OPEN API PPOB (Digiflazz, IAK, Raja-Biller) dan pembayaran (bdPay, Midtrans, DOKU, Xendit).' },
  fees: { title: 'Biaya Layanan', desc: 'Biaya admin dan biaya layanan terpisah untuk PPOB dan Transfer Request.' },
  taxes: { title: 'Pajak', desc: 'Item pajak (PPN, PPh, dll.) yang dihitung di keranjang checkout.' },
  limits: { title: 'Limit Transaksi', desc: 'Batas nominal per transfer dan total harian per pengguna (IDR).' },
  transactions: { title: 'Transaksi PPOB', desc: 'Riwayat pembelian produk digital. Tidak termasuk Transfer Request.' },
  transfers: { title: 'Transfer Request', desc: 'Semua Transfer Request (Personal + Merchant) dan status Virtual Account dari seluruh pengguna.' },
  'va-sim': { title: 'Simulasi Bayar VA', desc: 'Simulasikan pembayaran VA untuk menguji status paid dan callback gateway.' },
  reports: { title: 'Laporan', desc: 'Laporan penjualan PPOB dan ringkasan penerbitan Virtual Account per pengguna.' },
  cms: { title: 'CMS & SEO', desc: 'Nama situs, copyright, SEO, hero homepage, dan kredensial admin.' },
  tnc: { title: 'S&K / Agreement', desc: 'Syarat & Ketentuan (S&K) dan Agreement Pengguna sesuai hukum Indonesia.' },
  audit: { title: 'Audit Keamanan', desc: 'Log aksi sistem: login, OTP, KYC, perubahan pengaturan.' },
  merchants: { title: 'Merchant UMKM', desc: 'Kartu Registrasi Merchant (PDF/cetak), On-Hold / Aktifkan, data wizard PIC & UMKM.' },
  messages: { title: 'Kotak Pesan', desc: 'Kirim dan terima pesan dengan merchant.' },
  iplists: { title: 'Whitelist / Blacklist', desc: 'IP dan domain yang diizinkan atau diblokir.' },
  'merchant-limits': { title: 'Limit Merchant', desc: 'Limit transfer per skala UMKM.' },
  users: { title: 'Pengguna', desc: 'Daftar pengguna, status KYC, dan kartu profil (foto KTP).' },
  databases: { title: 'Database', desc: 'JSON Store, Lowdb, MongoDB Atlas, Supabase — mapping fitur ke backend.' },
  i18n: { title: 'Translasi', desc: 'Kamus ID / EN / CN untuk antarmuka.' },
  smtp: { title: 'SMTP & Email', desc: 'Server email OTP dan laporan.' },
  sms: { title: 'SMS Gateway', desc: 'OTP via SMS/WhatsApp gateway.' },
  'ai-settings': { title: 'AI Provider', desc: 'OpenAI, Grok xAI, Gemini, Groq, Google AI Studio, DeepSeek, Qwen — prioritas switch & parallel.' },
  'ai-activity': { title: 'Laporan Aktivitas AI', desc: 'Log task AI real-time: provider, durasi, hasil.' },
  audible: { title: 'Audible', desc: 'Aksesibilitas TTS dan AI Assistance.' }
};

function showSection(name) {
  document.querySelectorAll('.section').forEach(s => {
    s.classList.remove('active');
    s.style.display = 'none';
  });
  document.querySelectorAll('.sidebar a[data-section]').forEach(a => a.classList.remove('active'));
  const sec = document.getElementById('sec-' + name);
  if (sec) {
    sec.classList.add('active');
    sec.style.display = 'block';
    const h1 = sec.querySelector('h1');
    const lead = sec.querySelector('.section-lead');
    const meta = PAGE_META[name];
    if (meta && h1) h1.textContent = meta.title;
    if (meta && lead) lead.textContent = meta.desc;
  }
  const link = document.querySelector('.sidebar a[data-section="' + name + '"]');
  if (link) link.classList.add('active');
  document.title = (PAGE_META[name]?.title || 'Admin') + ' — bdPay Admin';
}

function startAdminIdle() {
  if (!window.BdSecurity) return;
  BdSecurity.startIdleWatch({
    onLogout: () => {
      try {
        sessionStorage.removeItem('admin_token');
        sessionStorage.removeItem('x-admin-user');
        sessionStorage.removeItem('x-admin-pass');
      } catch (_) {}
      adminToken = '';
      if (typeof adminToast === 'function') adminToast('Sesi admin berakhir. Silakan login kembali.', 'warn', 4000);
      else if (typeof adminConfirm === 'function') { /* noop */ }
      setTimeout(() => { window.location.href = '/admin/'; }, 800);
    }
  });
}
function enterAdminApp(opts) {
  opts = opts || {};
  const login = document.getElementById('login-screen');
  const app = document.getElementById('admin-app');
  if (login) {
    login.classList.add('hidden', 'is-gone');
    login.style.display = 'none';
    login.setAttribute('aria-hidden', 'true');
  }
  if (app) {
    app.classList.remove('hidden');
    app.style.display = 'flex';
  }
  try { startAdminIdle(); } catch (_) {}

  const goTotp = async () => {
    showSection('totp-admin');
    try { if (typeof loadTotpStatus === 'function') await loadTotpStatus(); } catch (_) {}
    try {
      if (typeof adminToast === 'function') adminToast('Pasang Google Authenticator untuk mengamankan akun Admin.', 'info', 5000);
      else if (typeof toast === 'function') toast('Pasang Google Authenticator untuk mengamankan akun Admin.', 'info');
    } catch (_) {}
  };
  const goDash = () => {
    showSection('dashboard');
    try { loadDashboard(); } catch (_) {}
  };

  // Prefer explicit flag from login response
  if (opts.forceTotp || opts.need_totp_pairing === true) {
    goTotp();
    return;
  }
  if (opts.need_totp_pairing === false || opts.totp_enabled === true) {
    goDash();
    return;
  }

  // Session restore: cek status TOTP
  (async () => {
    try {
      const r = await fetch(API + '/admin/totp/status', { headers: authHeaders() });
      const j = await r.json();
      const d = j.data || {};
      if (!d.enabled || d.require_pairing) goTotp();
      else goDash();
    } catch (_) {
      goDash();
    }
  })();
}

// Login
document.getElementById('admin-login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const errEl = document.getElementById('login-err');
  const btn = e.target.querySelector('button[type="submit"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Memproses…'; }
  try {
    const res = await fetch(API + '/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: String(fd.get('username') || '').trim(),
        password: String(fd.get('password') || ''),
        totp: String(document.getElementById('admin-totp')?.value || '').trim()
      })
    });
    let json;
    try { json = await res.json(); }
    catch (_) { throw new Error('Server tidak merespons JSON — pastikan Node server berjalan (npm start)'); }
    if (json.require_totp) {
      const wrap = document.getElementById('admin-totp-wrap');
      if (wrap) wrap.style.display = '';
      if (errEl) errEl.innerHTML = '<div class="alert alert-error">' + (json.message || 'Isi kode Authenticator') + '</div>';
    } else if (json.success && json.token) {
      adminToken = json.token;
      sessionStorage.setItem('admin_token', adminToken);
      if (errEl) errEl.innerHTML = '';
      enterAdminApp({
        need_totp_pairing: !!json.need_totp_pairing,
        totp_enabled: !!json.totp_enabled,
        forceTotp: !!json.need_totp_pairing
      });
    } else {
      if (errEl) errEl.innerHTML = '<div class="alert alert-error">' + (json.message || 'Login gagal') + '</div>';
    }
  } catch (err) {
    if (errEl) errEl.innerHTML = '<div class="alert alert-error">' + (err.message || 'Gagal terhubung ke server') + '</div>';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Masuk'; }
  }
});

if (adminToken) enterAdminApp();

// Nav
document.querySelectorAll('.sidebar a[data-section]').forEach(a => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const sec = a.getAttribute('data-section');
    showSection(sec);
    if (sec === 'dashboard') loadDashboard();
    if (sec === 'products') loadProducts();
    if (sec === 'products-api') loadProductsApi();
    if (sec === 'faqs') loadFaqs();
    if (sec === 'settings') loadSettings();
    if (sec === 'preferred-banks') loadPreferredBanks();
    if (sec === 'remittance') loadRemittanceAdmin();
    if (sec === 'api-monitor') loadApiMonitor();
    if (sec === 'fees') loadFees();
    if (sec === 'taxes') loadTaxes();
    if (sec === 'limits') loadLimits();
    if (sec === 'transactions') loadTransactions();
    if (sec === 'transfers') loadTransfers();
    if (sec === 'reports') loadReports();
    if (sec === 'reports-v2') loadReportsV2();
    if (sec === 'cms') loadCMS();
    if (sec === 'maintenance') loadMaintenance();
    if (sec === 'omnichannel') loadOmnichannel();
    if (sec === 'landing-promo') loadLandingPromo();
    if (sec === 'totp-admin') loadTotpStatus();
    if (sec === 'tnc') loadTNC();
    if (sec === 'audit') loadAudit();
    if (sec === 'users') loadUsers();
    if (sec === 'merchants') loadMerchants();
    if (sec === 'merchant-menu') loadMerchantMenu();
    if (sec === 'messages') loadAdminMessages();
    if (sec === 'iplists') loadIpLists();
    if (sec === 'merchant-limits') loadMerchantLimits();
    if (sec === 'databases') loadDatabases();
    if (sec === 'i18n') loadI18n();
    if (sec === 'smtp') loadSmtp();
    if (sec === 'sms') loadSms();
    if (sec === 'ai-settings') loadAiSettings();
    if (sec === 'ai-activity') loadAiActivity();
    if (sec === 'audible') loadAudible();
  });
});

document.getElementById('admin-logout')?.addEventListener('click', (e) => {
  e.preventDefault();
  sessionStorage.removeItem('admin_token');
  sessionStorage.removeItem('x-admin-user');
  sessionStorage.removeItem('x-admin-pass');
  window.location.href = '/admin/';
});

document.getElementById('modal-close')?.addEventListener('click', () => {
  document.getElementById('modal-overlay')?.classList.add('hidden');
});

// —— Dashboard ——
async function loadDashboard() {
  try {
    const [p, u, t, tr] = await Promise.all([
      fetch(API + '/admin/products', { headers: authHeaders() }).then(r => r.json()),
      fetch(API + '/admin/users', { headers: authHeaders() }).then(r => r.json()),
      fetch(API + '/admin/reports/all', { headers: authHeaders() }).then(r => r.json()),
      fetch(API + '/admin/transfers', { headers: authHeaders() }).then(r => r.json())
    ]);
    const products = p.data || [];
    const users = u.data || [];
    const txs = (t.data || []).filter(x => x.type !== 'domestic_transfer' && !String(x.ref_id||'').startsWith('TO-'));
    const transfers = tr.data || [];
    const set = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
    set('stat-products', products.length);
    set('stat-users', users.length);
    set('stat-tx', txs.length);
    set('stat-transfers', transfers.length);
    const vol = txs.reduce((s, x) => s + (Number(x.total || x.amount) || 0), 0)
      + transfers.reduce((s, x) => s + (Number(x.base_amount || x.amount) || 0), 0);
    set('stat-volume', 'Rp ' + vol.toLocaleString('id-ID'));
    renderMonthlyChart('chart-ppob', txs, 'total', 'amount');
    renderMonthlyChart('chart-va', transfers, 'base_amount', 'amount');
  } catch (e) { console.warn('dashboard', e); }
}

/** Grafik batang pure SVG — nominal & status per bulan (12 bulan terakhir) */
function renderMonthlyChart(elId, rows, amountKey, amountKey2) {
  const el = document.getElementById(elId);
  if (!el) return;
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    months.push({ key, label: d.toLocaleString('id-ID', { month: 'short', year: '2-digit' }), nominal: 0, success: 0, pending: 0, fail: 0, count: 0 });
  }
  const map = Object.fromEntries(months.map(m => [m.key, m]));
  (rows || []).forEach(r => {
    const dt = r.created_at || r.paid_at || r.date || '';
    const key = String(dt).slice(0, 7);
    if (!map[key]) return;
    const amt = Number(r[amountKey] != null ? r[amountKey] : r[amountKey2]) || 0;
    map[key].nominal += amt;
    map[key].count++;
    const st = String(r.status || '').toLowerCase();
    if (st === 'success' || st === 'paid' || st === 'settlement') map[key].success++;
    else if (st === 'pending' || st === 'waiting_payment') map[key].pending++;
    else map[key].fail++;
  });
  const maxN = Math.max(1, ...months.map(m => m.nominal));
  const W = 360, H = 180, pad = 28, barW = (W - pad * 2) / 12 - 4;
  let bars = '';
  months.forEach((m, i) => {
    const x = pad + i * ((W - pad * 2) / 12);
    const h = Math.round((m.nominal / maxN) * (H - pad - 20));
    const y = H - pad - h;
    const color = m.success > 0 && m.fail === 0 ? '#16a34a' : (m.pending > 0 ? '#f59e0b' : (m.nominal > 0 ? '#2563eb' : '#e2e8f0'));
    bars += `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(h, 2)}" fill="${color}" rx="3"><title>${m.label}: Rp ${m.nominal.toLocaleString('id-ID')} · OK ${m.success} · Pending ${m.pending} · Gagal ${m.fail}</title></rect>`;
    bars += `<text x="${x + barW / 2}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#64748b">${m.label.split(' ')[0]}</text>`;
  });
  const legend = `<div style="display:flex;gap:12px;font-size:0.75rem;color:#64748b;margin-top:8px;flex-wrap:wrap">
    <span><span style="display:inline-block;width:10px;height:10px;background:#16a34a;border-radius:2px"></span> Sukses</span>
    <span><span style="display:inline-block;width:10px;height:10px;background:#f59e0b;border-radius:2px"></span> Pending</span>
    <span><span style="display:inline-block;width:10px;height:10px;background:#2563eb;border-radius:2px"></span> Ada transaksi</span>
  </div>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="200" style="max-width:100%">${bars}</svg>${legend}
    <p style="font-size:0.75rem;color:#94a3b8;margin:4px 0 0">Hover batang untuk detail nominal & status</p>`;
}


// —— Products ——


async function loadProductsApi() {
  const el = document.getElementById('papi-table');
  if (!el) return;
  let catalog = window.__providerCatalog || [];
  let registered = [];
  try {
    const j = await adminJson(API + '/admin/products', { headers: authHeaders() });
    registered = j.data || [];
  } catch (_) {}

  const isActiveSku = (sku, provider) => {
    const s = String(sku || '').toLowerCase();
    const p = String(provider || '').toLowerCase();
    return registered.some(x => String(x.sku || '').toLowerCase() === s && x.active !== false &&
      (!p || String(x.provider_api || x.provider || '').toLowerCase().includes(p.split(' ')[0])));
  };

  function renderCatalog() {
    const q = (document.getElementById('papi-q')?.value || '').toLowerCase();
    const cat = document.getElementById('papi-cat')?.value || '';
    let list = catalog.slice();
    if (cat) list = list.filter(p => String(p.category || '') === cat);
    if (q) list = list.filter(p => (p.name || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q));
    if (!list.length) {
      el.innerHTML = '<p class="wiz-hint" style="color:#64748b">Belum ada data. Pilih provider lalu tekan <strong>Load PPOB API Provider</strong>.</p>';
      return;
    }
    el.innerHTML = `<div class="table-wrap"><table class="data-table admin-table"><thead><tr>
      <th><input type="checkbox" id="papi-check-all" title="Pilih semua"></th>
      <th>Nama</th><th>SKU</th><th>Kategori</th><th>Provider</th><th>Harga</th><th>Status di Katalog</th><th></th>
    </tr></thead><tbody>` + list.map((p, i) => {
      const prov = p.provider_api || p.provider || '-';
      const on = isActiveSku(p.sku, prov);
      return `<tr>
        <td><input type="checkbox" class="papi-cb" data-i="${i}" ${on ? 'disabled' : ''}></td>
        <td>${esc(p.name)}</td>
        <td><code>${esc(p.sku)}</code></td>
        <td>${esc(p.category || '-')}</td>
        <td><span class="badge">${esc(prov)}</span></td>
        <td>Rp ${Number(p.price || 0).toLocaleString('id-ID')}</td>
        <td>${on ? '<span class="badge badge-success">Sudah aktif</span>' : '<span class="badge">Belum</span>'}</td>
        <td>${on ? '' : `<button type="button" class="btn btn-primary btn-sm" data-papi-act="${i}">Aktifkan</button>`}</td>
      </tr>`;
    }).join('') + '</tbody></table></div>';
    // map indices to filtered list
    el._list = list;
    document.getElementById('papi-check-all')?.addEventListener('change', (e) => {
      el.querySelectorAll('.papi-cb:not(:disabled)').forEach(cb => { cb.checked = e.target.checked; });
    });
    el.querySelectorAll('[data-papi-act]').forEach(btn => {
      btn.onclick = async () => {
        const item = el._list[Number(btn.dataset.papiAct)];
        if (!item) return;
        await activateProviderItems([item]);
      };
    });
  }

  async function activateProviderItems(items) {
    if (!items.length) { adminToast('Pilih produk dulu', 'warn'); return; }
    const body = {
      items: items.map(it => ({
        name: it.name,
        sku: it.sku,
        category: it.category || 'prabayar',
        provider: it.provider || it.provider_api,
        provider_api: it.provider_api || it.provider,
        price: it.price,
        active: true
      }))
    };
    const r = await fetch(API + '/admin/products/activate-from-provider', {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(body)
    });
    const j = await r.json();
    adminToast(j.message || (j.success ? 'Diaktifkan' : 'Gagal'), j.success ? 'success' : 'error');
    if (j.success) {
      try {
        const j2 = await adminJson(API + '/admin/products', { headers: authHeaders() });
        registered = j2.data || [];
      } catch (_) {}
      renderCatalog();
    }
  }

  document.getElementById('papi-load').onclick = async () => {
    const provider = document.getElementById('papi-provider').value;
    el.innerHTML = '<p style="color:#64748b">Memuat katalog ' + esc(provider) + '…</p>';
    try {
      const r = await fetch(API + '/admin/products/from-provider?provider=' + encodeURIComponent(provider), { headers: authHeaders() });
      const j = await r.json();
      if (!j.success) { el.innerHTML = '<p class="alert alert-error">' + esc(j.message || 'Gagal') + '</p>'; return; }
      catalog = j.data || [];
      window.__providerCatalog = catalog;
      const src = document.getElementById('papi-source');
      if (src) src.textContent = 'Sumber: ' + (j.source || '-') + ' · ' + catalog.length + ' produk';
      renderCatalog();
    } catch (e) {
      el.innerHTML = '<p class="alert alert-error">' + esc(e.message) + '</p>';
    }
  };
  document.getElementById('papi-q').oninput = () => renderCatalog();
  document.getElementById('papi-cat').onchange = () => renderCatalog();
  document.getElementById('papi-activate-selected').onclick = async () => {
    const list = el._list || [];
    const items = [];
    el.querySelectorAll('.papi-cb:checked').forEach(cb => {
      const it = list[Number(cb.dataset.i)];
      if (it) items.push(it);
    });
    await activateProviderItems(items);
  };
  renderCatalog();
}


async function loadProducts() {
  const res = await fetch(API + '/admin/products', { headers: authHeaders() });
  const json = await res.json();
  const el = document.getElementById('products-table');
  if (!el) return;
  let list = json.data || [];
  if (!el.dataset.wired) {
    el.dataset.wired = '1';
    el.innerHTML = `<div class="table-toolbar" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px">
      <input type="search" id="prod-q" placeholder="Cari nama, SKU, provider…" style="flex:1;min-width:160px;padding:8px 10px;border-radius:8px;border:1px solid #e2e8f0">
      <select id="prod-sort"><option value="name">Nama</option><option value="price">Harga</option><option value="provider">Provider</option><option value="category">Kategori</option></select>
      <select id="prod-size"><option value="10">10</option><option value="50">50</option><option value="100">100</option></select>
      <select id="prod-import-prov"><option value="digiflazz">Digiflazz</option><option value="iak">IAK</option><option value="raja-biller">Raja-Biller</option></select>
      <button type="button" class="btn btn-outline btn-sm" id="prod-import">Ambil dari API Provider</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-add-product">+ Tambah Produk</button>
    </div><div id="prod-grid"></div><div id="prod-pager" class="m-pager"></div>`;
    el.querySelector('#prod-q').oninput = () => renderProd();
    el.querySelector('#prod-sort').onchange = () => renderProd();
    el.querySelector('#prod-size').onchange = () => renderProd();
    el.querySelector('#prod-import').onclick = async () => {
      const provider = el.querySelector('#prod-import-prov').value;
      adminToast('Mengambil katalog ' + provider + '…', 'info');
      const r = await fetch(API + '/admin/products/from-provider?provider=' + encodeURIComponent(provider), { headers: authHeaders() });
      const j = await r.json();
      if (!j.success) { adminToast(j.message || 'Gagal', 'error'); return; }
      let n = 0;
      for (const p of (j.data || [])) {
        const body = { name: p.name, sku: p.sku, category: p.category, price: p.price, provider: p.provider || provider, provider_api: p.provider_api || provider, active: true };
        await fetch(API + '/admin/products', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
        n++;
      }
      adminToast('Impor ' + n + ' produk (' + (j.source || 'catalog') + ')', 'success');
      loadProducts();
    };
  }
  let page = 1;
  function renderProd() {
    const q = (document.getElementById('prod-q')?.value || '').toLowerCase();
    const sort = document.getElementById('prod-sort')?.value || 'name';
    const size = Number(document.getElementById('prod-size')?.value || 10);
    let rows = list.filter(p => {
      const hay = [p.name, p.sku, p.provider, p.provider_api, p.category].join(' ').toLowerCase();
      return !q || hay.includes(q);
    });
    rows.sort((a, b) => {
      if (sort === 'price') return Number(a.price || 0) - Number(b.price || 0);
      return String(a[sort] || a.provider_api || '').localeCompare(String(b[sort] || b.provider_api || ''));
    });
    const pages = Math.max(1, Math.ceil(rows.length / size));
    if (page > pages) page = pages;
    const slice = rows.slice((page - 1) * size, page * size);
    const grid = document.getElementById('prod-grid');
    grid.innerHTML = `<table><thead><tr><th>Nama</th><th>SKU</th><th>Kategori</th><th>Provider</th><th>Harga</th><th>Status</th><th></th></tr></thead><tbody>` +
      (slice.map(p => {
        const active = p.active !== false;
        const prov = p.provider || p.provider_api || '-';
        return `<tr>
          <td>${esc(p.name)}</td><td><code>${esc(p.sku)}</code></td><td>${esc(p.category)}</td>
          <td><span class="badge">${esc(prov)}</span></td>
          <td>Rp ${Number(p.price || 0).toLocaleString('id-ID')}</td>
          <td><button class="btn btn-sm ${active ? 'btn-primary' : 'btn-outline'}" onclick="toggleProduct('${p.id}', ${active ? 'false' : 'true'})">${active ? 'Aktif' : 'Nonaktif'}</button></td>
          <td><button class="btn btn-sm btn-outline" onclick="deleteProduct('${p.id}')">Hapus</button></td>
        </tr>`;
      }).join('') || '<tr><td colspan="7">Kosong</td></tr>') + '</tbody></table>';
    const pager = document.getElementById('prod-pager');
    let ph = `<span style="font-size:.8rem;color:#64748b">${rows.length} produk · ${page}/${pages}</span>`;
    for (let i = 1; i <= pages && i <= 20; i++) ph += `<button type="button" class="${i===page?'active':''}" data-p="${i}">${i}</button>`;
    pager.innerHTML = ph;
    pager.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { page = Number(b.dataset.p); renderProd(); });
  }
  renderProd();
}

async function loadTransfers() {
  const el = document.getElementById('transfers-table');
  if (!el) return;
  el.innerHTML = '<p style="color:#64748b">Memuat…</p>';
  const render = (list) => {
    if (!list.length) {
      el.innerHTML = `<div class="table-wrap"><table class="data-table admin-table"><thead><tr><th>Tanggal</th><th>Order</th><th>User</th><th>VA</th><th>Nominal</th><th>Status</th><th>Provider</th></tr></thead>
      <tbody><tr><td colspan="7" style="color:#64748b;text-align:center">Belum ada transfer VA.</td></tr></tbody></table></div>`;
      return;
    }
    el.innerHTML = '<div class="table-wrap"><table class="data-table admin-table"><thead><tr><th>Tanggal</th><th>Order</th><th>User</th><th>VA</th><th>Nominal</th><th>Status</th><th>Provider</th></tr></thead><tbody>' +
      list.map(tr => {
        const st = tr.status === 'paid' || tr.status === 'success' ? 'success' : (tr.status === 'pending' ? 'warning' : 'danger');
        const dt = (tr.created_at||'').replace('T',' ').slice(0,19);
        const nom = Number(tr.base_amount != null ? tr.base_amount : tr.amount) || 0;
        return `<tr>
          <td><small>${dt}</small></td>
          <td><code>${tr.order_no || '-'}</code></td>
          <td>${tr.user_email || tr.user_id || '-'}</td>
          <td><code>${tr.va_number || '-'}</code></td>
          <td>Rp ${nom.toLocaleString('id-ID')}</td>
          <td><span class="badge badge-${st}">${tr.status || '-'}</span></td>
          <td>${tr.provider || '-'}</td>
        </tr>`;
      }).join('') + '</tbody></table>';
  };
  try {
    const r = await fetch(API + '/admin/transfers', { headers: authHeaders() });
    const j = await r.json();
    let list = j.data || [];
    if (!list.length) {
      const rt = await fetch(API + '/admin/reports/all', { headers: authHeaders() });
      const jt = await rt.json();
      list = (jt.data || []).filter(tx =>
        tx.type === 'domestic_transfer' ||
        String(tx.product_name || '').includes('Domestic Transfer') ||
        String(tx.ref_id || '').startsWith('TO-')
      ).map(tx => ({
        order_no: tx.ref_id,
        user_email: tx.user_id,
        va_number: tx.va_number,
        amount: tx.amount || tx.total,
        status: tx.status === 'success' ? 'paid' : (tx.status || 'pending'),
        provider: tx.provider_payment,
        created_at: tx.created_at
      }));
    }
    window.__tableCache = window.__tableCache || {};
    window.__tableCache.transfers = list;
    if (typeof bindTableTools === 'function') {
      bindTableTools('tr-search', 'tr-sort', 'transfers', render, 'tr-pagesize', 'tr-page');
      applyTableFilterSort('transfers', 'tr-search', 'tr-sort', render, 'tr-pagesize', 'tr-page');
    } else {
      render(list);
    }
  } catch (e) {
    el.innerHTML = '<p style="color:#b91c1c">Gagal: ' + e.message + '</p>';
  }
}

async function loadReports() {
  const box = document.getElementById('report-table');
  const sum = document.getElementById('report-summary');
  try {
    const [txRes, trRes] = await Promise.all([
      fetch(API + '/admin/reports/all', { headers: authHeaders() }).then(r => r.json()),
      fetch(API + '/admin/transfers', { headers: authHeaders() }).then(r => r.json())
    ]);
    const txs = txRes.data || [];
    const transfers = trRes.data || [];
    let feeIncome = 0;
    const rows = [];
    const seen = new Set();
    function rowKey(t) {
      if (t.va_number) return 'va:' + t.va_number;
      if (t.order_no || t.ref_id || t.ref) return 'ord:' + (t.order_no || t.ref_id || t.ref);
      return 'id:' + (t.id || Math.random());
    }
    function resolveType(t) {
      const jenis = t.jenis || '';
      const typ = String(t.type || '').toLowerCase();
      const ord = String(t.order_no || t.ref_id || t.ref || '');
      if (jenis === 'Transfer Request' || jenis === 'Vendor Pay' || jenis === 'PPOB') return jenis;
      if (typ === 'saldo_topup' || typ === 'domestic_transfer' || typ === 'transfer_va' || ord.startsWith('MTP-') || ord.startsWith('MTR-')) return 'Transfer Request';
      if (typ === 'vendor_pay' || ord.startsWith('MVA-')) return 'Vendor Pay';
      if (typ === 'ppob' || ord.startsWith('MPP-') || ord.startsWith('TRX-')) return 'PPOB';
      if (t.product_name || t.product_id) return 'PPOB';
      if (t.va_number) return 'Transfer Request';
      return 'PPOB';
    }
    // reports/all sudah gabungan — jangan double-add transfers
    txs.forEach(t => {
      const k = rowKey(t);
      if (seen.has(k)) return;
      seen.add(k);
      const fee = Number(t.fee || 0);
      feeIncome += fee;
      const typ = resolveType(t);
      rows.push({
        date: (t.created_at || '').replace('T', ' ').slice(0, 19),
        type: typ,
        ref: t.order_no || t.ref_id || t.ref || '',
        detail: t.product_name || t.va_number || t.name || '-',
        total: Number(t.grand_total != null ? t.grand_total : (t.total || t.amount || 0)),
        fee,
        status: t.status
      });
    });
    transfers.forEach(t => {
      const k = rowKey(t);
      if (seen.has(k)) return;
      seen.add(k);
      const fee = Number(t.fee || 0);
      feeIncome += fee;
      rows.push({
        date: (t.created_at || '').replace('T', ' ').slice(0, 19),
        type: resolveType(t),
        ref: t.order_no || '',
        detail: (t.va_number || '') + (t.bank ? ' ' + t.bank : ''),
        total: Number(t.grand_total != null ? t.grand_total : (t.amount || 0)),
        fee,
        status: t.status
      });
    });
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (sum) {
      sum.innerHTML = `
        <div class="stat-card"><h3>${rows.length}</h3><p>Semua Transaksi</p></div>
        <div class="stat-card"><h3>Rp ${rows.reduce((s,r)=>s+r.total,0).toLocaleString('id-ID')}</h3><p>Volume</p></div>
        <div class="stat-card"><h3>Rp ${feeIncome.toLocaleString('id-ID')}</h3><p>Pendapatan Fee</p></div>`;
    }
    window.__tableCache.rpt = rows.map(r => ({ ...r, created_at: r.date, amount: r.total, nominal: r.total }));
    const renderRpt = (list) => {
      if (!box) return;
      box.innerHTML = `<table><thead><tr><th>Tanggal</th><th>Jenis</th><th>Ref</th><th>Detail</th><th>Total</th><th>Fee</th><th>Status</th></tr></thead><tbody>` +
        (list.map(r => `<tr>
          <td><small>${r.date}</small></td><td>${r.type}</td><td><code>${r.ref||'-'}</code></td>
          <td>${r.detail}</td><td>Rp ${Number(r.total||0).toLocaleString('id-ID')}</td>
          <td>Rp ${Number(r.fee||0).toLocaleString('id-ID')}</td><td>${r.status}</td>
        </tr>`).join('') || '<tr><td colspan="7">Kosong</td></tr>') + '</tbody></table>';
    };
    bindTableTools('rpt-search', 'rpt-sort', 'rpt', renderRpt, 'rpt-pagesize', 'rpt-page');
    applyTableFilterSort('rpt', 'rpt-search', 'rpt-sort', renderRpt, 'rpt-pagesize', 'rpt-page');

  } catch (e) {
    if (box) box.innerHTML = '<p style="color:#b91c1c">Gagal laporan: ' + e.message + '</p>';
  }
}
document.getElementById('btn-load-report')?.addEventListener('click', loadReports);

// —— CMS ——
async function loadCMS() {
  try {
    const hs = await adminJson(API + '/admin/settings', { headers: authHeaders() });
    const https = (hs.data && hs.data.https) || {};
    const el = (id) => document.getElementById(id);
    if (el('https_force')) el('https_force').checked = !!https.force_https;
    if (el('https_hsts')) el('https_hsts').checked = https.hsts !== false;
    if (el('https_preload')) el('https_preload').checked = !!https.hsts_preload;
    if (el('https_hsts_max')) el('https_hsts_max').value = https.hsts_max_age || 31536000;
    if (el('https_csp')) el('https_csp').value = https.content_security_policy || '';
  } catch (_) {}

  const [setRes, cmsRes] = await Promise.all([
    fetch(API + '/admin/settings', { headers: authHeaders() }).then(r => r.json()),
    fetch(API + '/admin/cms', { headers: authHeaders() }).then(r => r.json())
  ]);
  const s = setRes.data || {};
  const c = cmsRes.data || {};
  const set = (id, v) => { const n = document.getElementById(id); if (n) n.value = v || ''; };
  set('site_name', s.site?.name);
  set('site_copyright', s.site?.copyright);
  set('seo_title', s.seo?.title);
  set('seo_desc', s.seo?.description);
  set('seo_keywords', s.seo?.keywords);
  set('hero_title', c.pages?.home?.hero_title);
  set('hero_sub', c.pages?.home?.hero_subtitle || c.hero?.subtitle || s.hero?.subtitle);
  set('contact_email', c.contact?.email || s.contact?.email);
  set('contact_phone', c.contact?.phone || s.contact?.phone);
  set('contact_wa', c.contact?.whatsapp || s.contact?.whatsapp);
  set('contact_addr', c.contact?.address || s.contact?.address);
  const ct = c.contact || {};
  set('contact_title', ct.title);
  set('contact_description', ct.description);
  set('contact_email', ct.email);
  set('contact_phone', ct.phone);
  set('contact_whatsapp', ct.whatsapp);
  set('contact_address', ct.address);
  set('contact_hours', ct.hours);
  set('admin_username', s.admin?.username || 'admin');
  if (s.site?.favicon) {
    const prev = document.getElementById('favicon-preview');
    if (prev) prev.src = s.site.favicon;
  }
}
document.getElementById('cms_favicon')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const r = await fetch(API + '/admin/settings', { headers: authHeaders() });
    const current = (await r.json()).data || {};
    if (!current.site) current.site = {};
    current.site.favicon = reader.result;
    await fetch(API + '/admin/settings', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(current) });
    const prev = document.getElementById('favicon-preview');
    if (prev) prev.src = reader.result;
    adminToast('Favicon disimpan', 'success');
  };
  reader.readAsDataURL(file);
});
document.getElementById('form-cms')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const setRes = await fetch(API + '/admin/settings', { headers: authHeaders() });
  const current = (await setRes.json()).data || {};
  if (!current.site) current.site = {};
  if (!current.seo) current.seo = {};
  current.site.name = document.getElementById('site_name')?.value || '';
  current.site.copyright = document.getElementById('site_copyright')?.value || '';
  current.seo.title = document.getElementById('seo_title')?.value || '';
  current.seo.description = document.getElementById('seo_desc')?.value || '';
  current.seo.keywords = document.getElementById('seo_keywords')?.value || '';
  await fetch(API + '/admin/settings', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(current) });
  const cmsRes = await fetch(API + '/admin/cms', { headers: authHeaders() });
  const cms = (await cmsRes.json()).data || {};
  if (!cms.pages) cms.pages = {};
  if (!cms.pages.home) cms.pages.home = {};
  cms.pages.home.hero_title = document.getElementById('hero_title')?.value || '';
  cms.pages.home.hero_subtitle = document.getElementById('hero_subtitle')?.value || '';
  cms.contact = {
    title: document.getElementById('contact_title')?.value || '',
    description: document.getElementById('contact_description')?.value || '',
    email: document.getElementById('contact_email')?.value || '',
    phone: document.getElementById('contact_phone')?.value || '',
    whatsapp: document.getElementById('contact_whatsapp')?.value || '',
    address: document.getElementById('contact_address')?.value || '',
    hours: document.getElementById('contact_hours')?.value || ''
  };
  await fetch(API + '/admin/cms', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(cms) });
  // HTTPS settings (settings.json)
  try {
    const setRes = await fetch(API + '/admin/settings', { headers: authHeaders() });
    const setJ = await setRes.json();
    const current = setJ.data || {};
    current.https = {
      force_https: !!document.getElementById('https_force')?.checked,
      hsts: !!document.getElementById('https_hsts')?.checked,
      hsts_preload: !!document.getElementById('https_preload')?.checked,
      hsts_max_age: Number(document.getElementById('https_hsts_max')?.value) || 31536000,
      content_security_policy: document.getElementById('https_csp')?.value || ''
    };
    await fetch(API + '/admin/settings', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(current) });
  } catch (e) { console.warn('https settings', e); }

  const msg = document.getElementById('cms-msg');
  if (msg) msg.innerHTML = '<div class="alert alert-success">CMS disimpan</div>';
});

document.getElementById('btn-save-admin-cred')?.addEventListener('click', async () => {
  const username = document.getElementById('admin_username')?.value.trim();
  const password = document.getElementById('admin_password_new')?.value;
  const r = await fetch(API + '/admin/credentials', {
    method: 'PUT', headers: authHeaders(),
    body: JSON.stringify({ username, password: password || undefined })
  });
  const j = await r.json();
  const msg = document.getElementById('admin-cred-msg');
  if (msg) msg.innerHTML = '<div class="alert alert-' + (j.success ? 'success' : 'error') + '">' + (j.message || '') + '</div>';
  if (j.success && password) {
    // update token base
    adminToken = btoa(username + ':' + password);
    sessionStorage.setItem('admin_token', adminToken);
  }
});

// —— T&C ——

document.getElementById('form-tnc')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await fetch(API + '/admin/settings', { headers: authHeaders() });
  const current = (await res.json()).data || {};
  if (!current.tnc) current.tnc = {};
  current.tnc.registration = document.getElementById('tnc_registration')?.value || '';
  current.tnc.purchase = document.getElementById('tnc_purchase')?.value || '';
  await fetch(API + '/admin/settings', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(current) });
  const msg = document.getElementById('tnc-msg');
  if (msg) msg.innerHTML = '<div class="alert alert-success">S&K / Agreement disimpan</div>';
});

// —— Audit ——

async function loadMerchantMenu() {
  const box = document.getElementById('merchant-menu-editor');
  if (!box) return;
  const labels = {
    dashboard: 'Dashboard', profile: 'Profil UMKM', 'register-flow': 'Kartu Registrasi',
    transfer: 'Transfer Request', vendor: 'Pembayaran Vendor', invoice: 'Invoice Payment',
    remittance: 'Global Remittance', saldo: 'Aktivasi Saldo', disbursement: 'Disbursement',
    ppob: 'Pembelian PPOB', reports: 'Laporan', audit: 'Audit Keamanan', inbox: 'Kotak Pesan'
  };
  try {
    const j = await adminJson(API + '/admin/merchant-menu', { headers: authHeaders() });
    const d = j.data || {};
    box.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">' +
      Object.keys(labels).map(k => {
        const vis = d[k] !== false;
        return `<label class="card-panel" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px;margin:0;cursor:pointer">
          <span style="font-weight:600;font-size:.9rem">${labels[k]}</span>
          <select data-mm="${k}" style="padding:6px 10px;border-radius:8px;border:1.5px solid #e2e8f0">
            <option value="1" ${vis?'selected':''}>Visible</option>
            <option value="0" ${!vis?'selected':''}>Hidden</option>
          </select>
        </label>`;
      }).join('') + '</div>';
  } catch (e) {
    box.innerHTML = '<p class="alert alert-error">' + esc(e.message) + '</p>';
  }
}
document.addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'btn-save-merchant-menu') {
    const body = {};
    document.querySelectorAll('[data-mm]').forEach(sel => {
      body[sel.dataset.mm] = sel.value === '1';
    });
    const r = await fetch(API + '/admin/merchant-menu', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
    const j = await r.json();
    const msg = document.getElementById('merchant-menu-msg');
    if (msg) msg.innerHTML = j.success ? '<div class="alert alert-success">Disimpan</div>' : '<div class="alert alert-error">' + esc(j.message||'Gagal') + '</div>';
    adminToast(j.message || (j.success ? 'Menu Merchant disimpan' : 'Gagal'), j.success ? 'success' : 'error');
  }
}, true);

async function loadAudit() {
  const el = document.getElementById('audit-table');
  if (!el) return;
  const scope = document.getElementById('audit-scope')?.value || 'all';
  el.innerHTML = '<p style="color:#64748b">Memuat audit…</p>';
  try {
    const res = await fetch(API + '/admin/audit?scope=' + encodeURIComponent(scope), { headers: authHeaders() });
    const json = await res.json();
    const list = json.data || [];
    const rows = list.slice(0, 200).map(a => {
      const isM = /merchant/i.test(String(a.action||'')) || /merchant/i.test(String(a.actor||''));
      const det = typeof a.detail === 'string' ? a.detail : (a.detail ? JSON.stringify(a.detail).slice(0, 120) : '');
      return `<tr>
        <td><small>${esc(a.ts || a.created_at || '')}</small></td>
        <td><code>${esc(a.action || '-')}</code> ${isM ? '<span class="badge">Merchant</span>' : ''}</td>
        <td>${esc(a.actor || '-')}</td>
        <td>${esc(a.ip || '-')}</td>
        <td>${esc(a.level || 'info')}</td>
        <td style="max-width:240px;font-size:.78rem;color:#64748b">${esc(det)}</td>
      </tr>`;
    }).join('');
    el.innerHTML = `<div class="table-wrap"><table class="data-table admin-table"><thead><tr>
      <th>Waktu</th><th>Aksi</th><th>Actor</th><th>IP</th><th>Level</th><th>Detail</th>
    </tr></thead><tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#64748b">Belum ada log</td></tr>'}</tbody></table></div>
    <p style="font-size:.8rem;color:#64748b;margin-top:8px">${list.length} entri</p>`;
  } catch (e) {
    el.innerHTML = '<p class="alert alert-error">' + esc(e.message) + '</p>';
  }
  document.getElementById('audit-scope')?.addEventListener('change', () => loadAudit());
  document.getElementById('btn-refresh-audit')?.addEventListener('click', () => loadAudit());
}

// —— Users ——
async function loadUsers() {
  const res = await fetch(API + '/admin/users', { headers: authHeaders() });
  const json = await res.json();
  const rows = (json.data || []).map(u => {
    const st = u.status || 'active';
    const holdLabel = st === 'on_hold' ? 'Aktifkan' : 'On-Hold';
    const nextSt = st === 'on_hold' ? 'active' : 'on_hold';
    const badge = st === 'on_hold'
      ? '<span class="badge badge-danger">On-Hold</span>'
      : '<span class="badge badge-success">Active</span>';
    return `<tr>
    <td>${escHtml(u.username || '-')}</td>
    <td>${escHtml(u.email || '-')}</td>
    <td>${escHtml(u.profile?.nama_ktp || '-')}<br><small>${escHtml(u.profile?.nik || '')}</small></td>
    <td>${escHtml(u.kyc_status || '-')} ${u.has_ktp ? '📷' : ''}</td>
    <td>${escHtml(u.profile?.kecamatan || '-')}, ${escHtml(u.profile?.kota || '-')}</td>
    <td>${badge}</td>
    <td style="white-space:nowrap">
      <button class="btn btn-sm btn-outline" onclick="viewUserCard('${u.id}')">Kartu</button>
      <button type="button" class="btn btn-sm btn-outline" data-user-hold="${u.id}" data-st="${nextSt}">${holdLabel}</button>
    </td>
  </tr>`;
  }).join('');
  const el = document.getElementById('users-table');
  if (el) {
    el.innerHTML = `<table><thead><tr><th>Username</th><th>Email</th><th>Nama/NIK</th><th>KYC</th><th>Lokasi</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${rows || '<tr><td colspan="7">Kosong</td></tr>'}</tbody></table>`;
    el.querySelectorAll('[data-user-hold]').forEach(btn => {
      btn.onclick = async () => {
        const r = await fetch(API + '/admin/users/' + btn.dataset.userHold + '/status', {
          method: 'PUT',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: btn.dataset.st })
        });
        const j = await r.json();
        if (typeof adminToast === 'function') adminToast(j.message || (j.success ? 'OK' : 'Gagal'), j.success ? 'success' : 'error');
        loadUsers();
      };
    });
  }
}

window.viewUserCard = async function (id) {
  const r = await fetch(API + '/admin/users/' + id + '/card', { headers: authHeaders() });
  const j = await r.json();
  if (!j.success) { adminToast(j.message || 'Gagal', 'error'); return; }
  const u = j.data;
  const p = u.profile || {};
  const orig = u.ktp_image
    ? `<div><strong>Foto KTP</strong><br><img src="${u.ktp_image}" alt="KTP" style="width:506px;max-width:100%;height:auto;aspect-ratio:506/319;object-fit:cover;border-radius:8px;margin-top:8px;border:1px solid #ccc"></div>`
    : '<p style="color:#6c757d">Belum ada foto KTP</p>';
  const hasProc = u.ktp_processed && String(u.ktp_processed).startsWith('data:image');
  const proc = hasProc
    ? `<div style="margin-top:12px">
        <button type="button" class="btn btn-outline btn-sm" id="btn-show-ktp-proc">Sembunyikan / Tampilkan hasil rekayasa</button>
        <div id="ktp-proc-box" style="display:block;margin-top:8px">
          <strong>Foto Hasil Rekayasa</strong><br>
          <img src="${u.ktp_processed}" alt="KTP hasil rekayasa" style="width:506px;max-width:100%;height:auto;aspect-ratio:506/319;object-fit:cover;border-radius:8px;border:1px solid #ccc;margin-top:6px;background:#f8fafc">
        </div></div>`
    : '<p style="color:#6c757d;margin-top:8px">Belum ada foto hasil rekayasa (pastikan Sharp terpasang & verifikasi OCR dijalankan)</p>';
  document.getElementById('modal-content').innerHTML = `
    <h2>Kartu Profil</h2>
    <div style="font-size:0.9rem;line-height:1.6">
      <div><strong>${p.nama_ktp || u.username}</strong></div>
      <div>NIK: ${p.nik || '-'}</div>
      <div>Email: ${u.email} ${u.email_verified ? '(verified)' : ''}</div>
      <div>Telp: ${u.phone || p.phone || '-'}</div>
      <div>Kecamatan: ${p.kecamatan || '-'}</div>
      <div>Kota: ${p.kota || '-'}</div>
      <div>Kode Pos: ${p.kode_pos || '-'}</div>
      <div>KYC: ${u.kyc_status || '-'} · T&C: ${u.tnc_accepted ? 'Ya' : '-'} · Agreement: ${u.agreement_accepted ? 'Ya' : '-'}</div>
      <hr style="margin:12px 0">${orig}${proc}
    </div>`;
  document.getElementById('modal-overlay')?.classList.remove('hidden');
  document.getElementById('btn-show-ktp-proc')?.addEventListener('click', () => {
    const box = document.getElementById('ktp-proc-box');
    if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
  });
};

// Password eye toggle
document.getElementById('toggle-admin-pass')?.addEventListener('click', function () {
  const i = document.getElementById('admin-password');
  if (!i) return;
  i.type = i.type === 'password' ? 'text' : 'password';
  this.textContent = i.type === 'password' ? '👁' : '🙈';
});



document.getElementById('btn-save-tnc')?.addEventListener('click', async () => {
  const body = {
    registration: document.getElementById('tnc_registration')?.value || '',
    purchase: document.getElementById('tnc_purchase')?.value || '',
    aml: document.getElementById('tnc_aml')?.value || '',
    consumer: document.getElementById('tnc_consumer')?.value || '',
    infosec: document.getElementById('tnc_infosec')?.value || '',
    cyber: document.getElementById('tnc_cyber')?.value || '',
    law: document.getElementById('tnc_law')?.value || ''
  };
  const r = await fetch(API + '/admin/tnc', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
  const j = await r.json();
  const msg = document.getElementById('tnc-msg');
  if (msg) msg.innerHTML = '<div class="alert alert-success">' + (j.message || 'S&K / Agreement disimpan') + '</div>';
  adminToast('S&K / Agreement disimpan', 'success');
});

document.getElementById('btn-save-cms')?.addEventListener('click', async () => {
  const body = {
    site: { name: document.getElementById('site_name')?.value, copyright: document.getElementById('site_copyright')?.value },
    seo: { title: document.getElementById('seo_title')?.value, description: document.getElementById('seo_desc')?.value },
    hero: { title: document.getElementById('hero_title')?.value, subtitle: document.getElementById('hero_sub')?.value },
    contact: {
      email: document.getElementById('contact_email')?.value,
      phone: document.getElementById('contact_phone')?.value,
      whatsapp: document.getElementById('contact_wa')?.value,
      address: document.getElementById('contact_addr')?.value
    }
  };
  await fetch(API + '/admin/cms', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
  const user = document.getElementById('admin_user_cms')?.value;
  const pass = document.getElementById('admin_pass_cms')?.value;
  if (user || pass) {
    await fetch(API + '/admin/credentials', { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ username: user, password: pass }) });
  }
  adminToast('CMS disimpan', 'success');
  const msg = document.getElementById('cms-msg');
  if (msg) msg.innerHTML = '<div class="alert alert-success">CMS disimpan</div>';
});

document.getElementById('prod-fetch-api')?.addEventListener('click', async () => {
  const provider = document.getElementById('prod-api-provider')?.value || 'digiflazz';
  const box = document.getElementById('prod-api-list');
  if (box) box.innerHTML = '<p style="color:#64748b">Mengambil produk sandbox…</p>';
  try {
    const r = await fetch(API + '/admin/products/from-provider?provider=' + encodeURIComponent(provider), { headers: authHeaders() });
    const j = await r.json();
    const list = j.data || [];
    if (!list.length) {
      if (box) box.innerHTML = '<p style="color:#b45309">Tidak ada data (sandbox). Isi manual.</p>';
      return;
    }
    if (box) {
      box.innerHTML = list.map((p, i) =>
        `<div style="padding:6px 0;border-bottom:1px solid #e2e8f0;cursor:pointer" data-api-prod="${i}">
          <strong>${p.name}</strong> · ${p.sku} · Rp ${Number(p.price||0).toLocaleString('id-ID')}
        </div>`
      ).join('');
      box.querySelectorAll('[data-api-prod]').forEach(el => {
        el.addEventListener('click', () => {
          const p = list[Number(el.getAttribute('data-api-prod'))];
          document.getElementById('prod-name').value = p.name || '';
          document.getElementById('prod-sku').value = p.sku || '';
          document.getElementById('prod-category').value = p.category || 'prabayar';
          document.getElementById('prod-provider').value = p.provider || provider;
          document.getElementById('prod-price').value = (typeof formatCurrencyInput==='function'?formatCurrencyInput(p.price||0):String(p.price||0));
          adminToast('Produk dipilih dari API', 'info');
        });
      });
    }
  } catch (e) {
    if (box) box.innerHTML = '<p style="color:#b91c1c">Gagal: ' + e.message + '</p>';
  }
});


/* Event delegation — product & FAQ modals (reliably bind after DOM ready) */
document.addEventListener('click', async (e) => {
  const t = e.target;
  if (!t || !t.id) return;
  if (t.id === 'prod-cancel') {
    document.getElementById('product-modal')?.classList.add('hidden');
  }
  if (t.id === 'prod-save') {
    const body = {
      name: document.getElementById('prod-name')?.value?.trim(),
      sku: document.getElementById('prod-sku')?.value?.trim(),
      category: document.getElementById('prod-category')?.value || 'prabayar',
      provider: document.getElementById('prod-provider')?.value?.trim() || '',
      price: (typeof parseCurrencyInput==='function'?parseCurrencyInput(document.getElementById('prod-price')?.value):Number(String(document.getElementById('prod-price')?.value||'').replace(/[^0-9]/g,''))) || 0,
      active: !!document.getElementById('prod-active')?.checked
    };
    if (!body.name || !body.sku) { adminToast('Nama dan SKU wajib diisi', 'warn'); return; }
    const r = await fetch(API + '/admin/products', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    const j = await r.json();
    if (j.success === false || r.status >= 400) { adminToast(j.message || 'Gagal', 'error'); return; }
    document.getElementById('product-modal')?.classList.add('hidden');
    adminToast('Produk disimpan', 'success');
    loadProducts();
  }
  if (t.id === 'btn-add-faq' || t.id === 'btn-add-faq-inline') {
    const idEl = document.getElementById('faq-id');
    if (idEl) idEl.value = '';
    const q = document.getElementById('faq-q'); if (q) q.value = '';
    const ans = document.getElementById('faq-a'); if (ans) ans.value = '';
    const title = document.getElementById('faq-modal-title'); if (title) title.textContent = 'Tambah FAQ';
    document.getElementById('faq-modal')?.classList.remove('hidden');
  }
  if (t.id === 'faq-cancel') {
    document.getElementById('faq-modal')?.classList.add('hidden');
  }
  if (t.id === 'faq-save') {
    const id = document.getElementById('faq-id')?.value;
    const body = {
      question: document.getElementById('faq-q')?.value?.trim(),
      answer: document.getElementById('faq-a')?.value?.trim()
    };
    if (!body.question || !body.answer) { adminToast('Isi pertanyaan & jawaban', 'warn'); return; }
    const url = id ? API + '/admin/faqs/' + id : API + '/admin/faqs';
    const method = id ? 'PUT' : 'POST';
    const r = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
    const j = await r.json();
    if (j.success === false) { adminToast(j.message || 'Gagal', 'error'); return; }
    document.getElementById('faq-modal')?.classList.add('hidden');
    adminToast('FAQ disimpan', 'success');
    loadFaqs();
  }
}, true);
window.__adminDelegates = true;


async function loadReportsV2() {
  const el = document.getElementById('report-v2-table');
  if (!el) return;
  const render = (rows) => {
    el.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr>
      <th>Tanggal</th><th>Jenis</th><th>Pengirim</th><th>NIK Pengirim</th><th>Penerima</th><th>Nominal</th><th>Status</th><th>Provider</th>
    </tr></thead><tbody>` + (rows.map(r => `<tr>
      <td><small>${escHtml(r.date || '')}</small></td>
      <td>${escHtml(r.jenis || '')}</td>
      <td>${escHtml(r.pengirim || '-')}</td>
      <td><code>${escHtml(r.nik || '-')}</code></td>
      <td>${escHtml(r.penerima || 'bdPay PWA')}</td>
      <td>Rp ${Number(r.nominal||0).toLocaleString('id-ID')}</td>
      <td>${escHtml(r.status || '-')}</td>
      <td>${escHtml(r.provider || '-')}</td>
    </tr>`).join('') || '<tr><td colspan="8">Kosong</td></tr>') + '</tbody></table></div>';
  };
  try {
    const rt = await adminJson(API + '/admin/reports/all', { headers: authHeaders() });
    const rows = (rt.data || []).map(t => {
      const isMerchant = t.channel === 'merchant' || t.source === 'merchant' || String(t.user_id||'').startsWith('merchant:');
      let jenis = t.jenis || t.type || '-';
      if (jenis === 'domestic_transfer' || jenis === 'saldo_topup' || jenis === 'transfer_va') jenis = 'Transfer Request';
      if (jenis === 'vendor_pay') jenis = 'Vendor Pay';
      if (jenis === 'ppob' || jenis === 'PPOB') jenis = 'PPOB';
      return {
        date: (t.created_at || '').replace('T', ' ').slice(0, 19),
        created_at: t.created_at,
        jenis,
        pengirim: t.pengirim || t.trade_name || t.user_name || t.user_label || (isMerchant ? 'Merchant' : '-'),
        nik: t.nik_pengirim || t.pic_nik || t.nik || '-',
        penerima: t.penerima || (jenis === 'PPOB' ? 'bdPay PWA' : (t.name || 'bdPay PWA')),
        nominal: Number(t.grand_total != null ? t.grand_total : (t.total || t.amount || 0)),
        status: t.status || '-',
        provider: t.provider_label || t.provider || t.payment_provider || (isMerchant ? 'bdPay · Merchant' : 'bdpay')
      };
    });
    window.__tableCache = window.__tableCache || {};
    window.__tableCache.rpt2 = rows;
    if (typeof bindTableControls === 'function') {
      bindTableControls({
        searchId: 'rpt2-search', sortId: 'rpt2-sort', sizeId: 'rpt2-size',
        pagerId: 'rpt2-pager', cacheKey: 'rpt2', render
      });
    } else {
      render(rows.slice(0, 10));
    }
  } catch (e) {
    console.error(e);
    el.innerHTML = '<p class="text-danger">Gagal memuat laporan: ' + escHtml(e.message) + '</p>';
  }
}


async function loadTnc() {
  const regDefault = 'Dengan mendaftar, Anda menyetujui Syarat dan Ketentuan yang berlaku sesuai hukum Republik Indonesia, termasuk UU ITE, UU PDP, dan peraturan Bank Indonesia terkait layanan pembayaran. Data pribadi Anda akan dilindungi. Transaksi bersifat final setelah berhasil. PT Berkah Digital Pembayaran berhak menolak transaksi mencurigakan.';
  const purDefault = 'Dengan melakukan pembelian, Anda menyetujui Agreement ini: 1. Memastikan data nomor tujuan benar. 2. Membayar sesuai nominal yang tertera termasuk biaya layanan. 3. Pengembalian dana hanya jika transaksi gagal dari sisi provider, ke rekening yang terdaftar. 4. Tidak ada refund untuk kesalahan input pengguna. Sesuai KUHP, UU Perlindungan Konsumen, dan regulasi terkait.';
  const defaults = {
    registration: regDefault,
    purchase: purDefault,
    aml: 'Persetujuan Anti Money Laundering (AML): Merchant wajib mematuhi UU No. 8 Tahun 2010 tentang Pencegahan dan Pemberantasan Tindak Pidana Pencucian Uang. Dilarang menggunakan layanan untuk transaksi ilegal, terorisme, atau menyembunyikan asal-usul dana. Merchant setuju data transaksi dapat dilaporkan ke otoritas berwenang.',
    consumer: 'Persetujuan Perlindungan Konsumen: Merchant wajib memberikan informasi yang jelas dan jujur kepada pelanggan sesuai UU No. 8 Tahun 1999 tentang Perlindungan Konsumen. Keluhan pelanggan wajib ditindaklanjuti. Refund mengikuti ketentuan platform dan hukum yang berlaku.',
    infosec: 'Persetujuan Keamanan Sistem Informasi: Merchant wajib menjaga kerahasiaan kredensial, tidak membagikan akses, dan segera melaporkan insiden keamanan. Data pelanggan hanya digunakan untuk keperluan layanan yang sah.',
    cyber: 'Persetujuan Keamanan Siber: Merchant setuju tidak melakukan aktivitas yang membahayakan infrastruktur (serangan, scraping ilegal, penyalahgunaan API). Platform berhak memblokir akses jika terdeteksi ancaman siber.',
    law: 'Persetujuan Taat Hukum & Pemblokiran Dana: Merchant tunduk pada hukum Republik Indonesia. Platform berhak memblokir, menahan, atau mengembalikan dana jika terdapat dugaan pelanggaran hukum, perintah pengadilan, atau permintaan otoritas berwenang.'
  };
  function set(id, v) { const n = document.getElementById(id); if (n) n.value = v || ''; }
  set('tnc_registration', defaults.registration);
  set('tnc_purchase', defaults.purchase);
  set('tnc_aml', defaults.aml);
  set('tnc_consumer', defaults.consumer);
  set('tnc_infosec', defaults.infosec);
  set('tnc_cyber', defaults.cyber);
  set('tnc_law', defaults.law);
  try {
    const r = await fetch(API + '/admin/tnc', { headers: authHeaders() });
    const j = await r.json();
    const d = j.data || {};
    ['registration','purchase','aml','consumer','infosec','cyber','law'].forEach(function (k) {
      const v = String(d[k] || '').trim();
      if (v) set(k === 'registration' ? 'tnc_registration' : (k === 'purchase' ? 'tnc_purchase' : 'tnc_' + k), v);
    });
  } catch (e) { console.warn('loadTnc', e); }
}
async function loadTNC() { return loadTnc(); }


function exportTable(tableContainerId, format) {
  const box = document.getElementById(tableContainerId);
  if (!box) { adminToast('Tabel tidak ditemukan', 'warn'); return; }
  const table = box.querySelector('table');
  if (!table) { adminToast('Belum ada data tabel', 'warn'); return; }
  const rows = [...table.querySelectorAll('tr')].map(tr =>
    [...tr.querySelectorAll('th,td')].map(c => c.innerText.replace(/\s+/g, ' ').trim())
  );
  const title = document.querySelector('.section.active h1')?.textContent || 'Laporan';
  if (format === 'xlsx' || format === 'csv') {
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (title.replace(/\s+/g, '_') || 'export') + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    adminToast('File CSV diunduh (buka di Excel)', 'success');
  } else if (format === 'pdf') {
    const w = window.open('', '_blank');
    if (!w) { adminToast('Izinkan pop-up untuk unduh PDF', 'warn'); return; }
    w.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
      <style>body{font-family:system-ui,sans-serif;padding:24px} h1{font-size:18px}
      table{border-collapse:collapse;width:100%;font-size:12px}
      th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
      th{background:#f1f5f9}</style></head><body>
      <h1>${title}</h1><p>bdPay PWA — ${new Date().toLocaleString('id-ID')}</p>
      ${table.outerHTML}
      <script>window.onload=function(){window.print()}<\/script>
      </body></html>`);
    w.document.close();
    adminToast('Siap cetak / simpan sebagai PDF', 'info');
  }
}
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-export]');
  if (!btn) return;
  exportTable(btn.getAttribute('data-export'), btn.getAttribute('data-format') || 'csv');
});


/** Validasi input form Backend Admin */
function validateAdminForm(root) {
  const scope = typeof root === 'string' ? document.querySelector(root) : (root || document);
  if (!scope) return true;
  const fields = scope.querySelectorAll('input[required], select[required], textarea[required]');
  let ok = true;
  const errors = [];
  fields.forEach(el => {
    el.classList.remove('is-invalid');
    const v = (el.value || '').trim();
    if (el.type === 'checkbox') {
      if (!el.checked) { ok = false; el.classList.add('is-invalid'); errors.push(el.name || el.id || 'checkbox'); }
      return;
    }
    if (!v) {
      ok = false;
      el.classList.add('is-invalid');
      errors.push(el.previousElementSibling?.textContent || el.id || 'field');
      return;
    }
    if (el.type === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      ok = false; el.classList.add('is-invalid'); errors.push('Email tidak valid');
    }
    if (el.type === 'number' && el.min !== '' && Number(v) < Number(el.min)) {
      ok = false; el.classList.add('is-invalid'); errors.push('Nilai terlalu kecil');
    }
  });
  // URL fields optional but if filled must look like URL or path
  scope.querySelectorAll('input[id*="webhook_url"], input[id*="_url"], input[id*="base"]').forEach(el => {
    const v = (el.value || '').trim();
    if (v && !/^(https?:\/\/|\/)/i.test(v)) {
      ok = false; el.classList.add('is-invalid');
      errors.push('URL harus diawali http(s):// atau /');
    }
  });
  if (!ok) adminToast('Periksa form: ' + errors.slice(0, 3).join(', '), 'warn');
  return ok;
}

document.getElementById('form-settings')?.addEventListener('submit', (e) => {
  if (!validateAdminForm('#form-settings')) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);

document.getElementById('btn-save-tnc')?.addEventListener('click', (e) => {
  const reg = document.getElementById('tnc_registration');
  const pur = document.getElementById('tnc_purchase');
  if (reg && !(reg.value || '').trim()) {
    e.preventDefault(); e.stopImmediatePropagation();
    reg.classList.add('is-invalid');
    adminToast('Syarat & Ketentuan wajib diisi', 'warn');
  }
  if (pur && !(pur.value || '').trim()) {
    e.preventDefault(); e.stopImmediatePropagation();
    pur.classList.add('is-invalid');
    adminToast('Agreement Pengguna wajib diisi', 'warn');
  }
}, true);

document.getElementById('btn-save-cms')?.addEventListener('click', (e) => {
  if (!validateAdminForm('#sec-cms')) {
    // soft: only if required fields exist
  }
}, true);


/** Format ribuan IDR dinamis (saat mengetik) — Backend Admin */
function parseCurrencyInput(val) {
  if (val == null || val === '') return 0;
  const n = String(val).replace(/[^0-9]/g, '');
  return n ? Number(n) : 0;
}
function formatCurrencyInput(val) {
  const n = parseCurrencyInput(val);
  if (!n && n !== 0) return '';
  if (n === 0 && String(val).replace(/[^0-9]/g, '') === '') return '';
  return n.toLocaleString('id-ID');
}
function bindCurrencyInputs(root) {
  const scope = typeof root === 'string' ? document.querySelector(root) : (root || document);
  if (!scope) return;
  const sel = 'input[data-currency], input.currency, input#limit-per-tx, input#limit-per-day, input[id*="price"], input[id*="amount"], input[id*="fee"], input[id*="limit"], input[id*="fixed"], input[name*="price"], input[name*="amount"], input[id*="value"]';
  scope.querySelectorAll(sel).forEach(el => {
    if (el.dataset.currencyBound === '1') return;
    el.dataset.currencyBound = '1';
    if (el.type === 'number') {
      try { el.type = 'text'; } catch (_) {}
    }
    el.setAttribute('inputmode', 'numeric');
    el.setAttribute('autocomplete', 'off');
    // Format awal
    if (el.value && /[0-9]/.test(el.value)) {
      el.value = formatCurrencyInput(el.value);
    }
    el.addEventListener('input', () => {
      const digits = String(el.value).replace(/[^0-9]/g, '').slice(0, 15);
      el.value = digits ? Number(digits).toLocaleString('id-ID') : '';
      try { const len = el.value.length; el.setSelectionRange(len, len); } catch (_) {}
      el.classList.remove('is-invalid');
    });
    el.addEventListener('blur', () => {
      const n = parseCurrencyInput(el.value);
      if (el.value && String(el.value).replace(/[^0-9]/g, '') === '') {
        el.classList.add('is-invalid');
      } else {
        el.classList.remove('is-invalid');
        el.value = n ? formatCurrencyInput(n) : '';
      }
    });
  });
}
window.parseCurrencyInput = parseCurrencyInput;
window.formatCurrencyInput = formatCurrencyInput;
window.bindCurrencyInputs = bindCurrencyInputs;
document.addEventListener('DOMContentLoaded', () => bindCurrencyInputs(document));
document.addEventListener('click', () => setTimeout(() => bindCurrencyInputs(document), 150));




// —— Webhook Test & VA Simulasi ——
document.getElementById('btn-webhook-test')?.addEventListener('click', async () => {
  const provider = document.getElementById('wh-test-provider')?.value || 'bdpay';
  const va_number = (document.getElementById('wh-test-va')?.value || '').trim();
  const order_id = (document.getElementById('wh-test-order')?.value || '').trim();
  const msg = document.getElementById('webhook-test-msg');
  if (!va_number && !order_id) {
    if (msg) msg.innerHTML = '<div class="alert alert-error">Isi VA Number atau Order ID</div>';
    adminToast('Isi VA Number atau Order ID', 'warn');
    return;
  }
  if (msg) msg.innerHTML = '<div class="alert alert-info">Mengirim webhook test…</div>';
  try {
    const r = await fetch(API + '/admin/webhooks/test', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ provider, va_number, order_id, status: 'paid' })
    });
    const j = await r.json();
    if (j.success) {
      if (msg) msg.innerHTML = '<div class="alert alert-success">' + (j.message || 'Webhook OK') + (j.paid ? ' · paid=true' : '') + '</div>';
      adminToast('Webhook test berhasil', 'success');
    } else {
      if (msg) msg.innerHTML = '<div class="alert alert-error">' + (j.message || 'Gagal') + '</div>';
      adminToast(j.message || 'Gagal', 'error');
    }
  } catch (e) {
    if (msg) msg.innerHTML = '<div class="alert alert-error">' + e.message + '</div>';
    adminToast('Gagal kirim webhook', 'error');
  }
});

document.getElementById('btn-webhook-logs')?.addEventListener('click', async () => {
  const box = document.getElementById('webhook-logs');
  if (!box) return;
  box.innerHTML = 'Memuat…';
  try {
    const r = await fetch(API + '/admin/webhooks/logs', { headers: authHeaders() });
    const j = await r.json();
    const logs = j.data || [];
    if (!logs.length) { box.innerHTML = '<p style="color:#64748b">Belum ada log.</p>'; return; }
    box.innerHTML = '<table><thead><tr><th>Waktu</th><th>Provider</th><th>Event</th><th>VA/Order</th><th>Status</th></tr></thead><tbody>' +
      logs.slice(0, 50).map(l => `<tr>
        <td><small>${(l.at||'').replace('T',' ').slice(0,19)}</small></td>
        <td>${l.provider||'-'}</td>
        <td>${l.event||'-'}</td>
        <td><code>${l.va||l.order_id||'-'}</code></td>
        <td>${l.status|| (l.paid ? 'paid' : '-') } ${l.reason ? '('+l.reason+')' : ''}</td>
      </tr>`).join('') + '</tbody></table>';
  } catch (e) {
    box.innerHTML = '<p style="color:#b91c1c">' + e.message + '</p>';
  }
});

document.getElementById('btn-va-sim-pay')?.addEventListener('click', async () => {
  const va = (document.getElementById('va-sim-number')?.value || '').trim();
  const order = (document.getElementById('va-sim-order')?.value || '').trim();
  const enabled = document.getElementById('va-sim-enabled')?.checked !== false;
  const msg = document.getElementById('va-sim-msg');
  if (!enabled) {
    if (msg) msg.innerHTML = '<div class="alert alert-error">Fitur simulasi nonaktif. Centang “Fitur simulasi aktif”.</div>';
    adminToast('Simulasi nonaktif', 'warn');
    return;
  }
  if (!va && !order) {
    if (msg) msg.innerHTML = '<div class="alert alert-error">Isi Nomor VA atau Nomor Transfer Order</div>';
    adminToast('Isi VA atau Order', 'warn');
    return;
  }
  if (msg) msg.innerHTML = '<div class="alert alert-info">Memproses simulasi…</div>';
  try {
    const r = await fetch(API + '/admin/va/simulate-pay', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ va_number: va, order_no: order, enabled: true })
    });
    const j = await r.json();
    if (j.success) {
      if (msg) msg.innerHTML = '<div class="alert alert-success">' + (j.message || 'Berhasil') +
        (j.data ? '<br>Order: <code>' + (j.data.order_no||'') + '</code> · Status: <strong>' + (j.data.status||'paid') + '</strong>' : '') + '</div>';
      adminToast('VA dibayar (simulasi)', 'success');
    } else {
      if (msg) msg.innerHTML = '<div class="alert alert-error">' + (j.message || 'Gagal') + '</div>';
      adminToast(j.message || 'Gagal', 'error');
    }
  } catch (e) {
    if (msg) msg.innerHTML = '<div class="alert alert-error">' + e.message + '</div>';
    adminToast('Gagal simulasi', 'error');
  }
});



// —— Merchant UMKM Admin ——
async function loadMerchants() {
  const box = document.getElementById('merchants-table') || document.getElementById('sec-merchants') || document.querySelector('[data-admin-sec="merchants"]');
  const host = document.getElementById('merchants-box') || document.getElementById('merchants-table') || document.getElementById('admin-merchants');
  const el = host || document.getElementById('merchants-list');
  if (!el && !host) {
    // try section inner
  }
  const target = document.getElementById('merchants-table') || document.getElementById('m-merchants-table') || document.querySelector('#sec-merchants .card-panel') || document.getElementById('merchants-box');
  if (!target) { console.warn('merchants target missing'); return; }
  let list = [];
  try {
    const j = await adminJson(API + '/admin/merchants', { headers: authHeaders() });
    list = j.data || [];
  } catch (e) { adminToast('Gagal muat merchant', 'error'); return; }

  if (!target.dataset.wired) {
    target.dataset.wired = '1';
    target.innerHTML = `<div class="table-toolbar">
      <input type="search" id="mch-q" placeholder="Cari nama, email, dagang…">
      <select id="mch-sort"><option value="date_desc">Terbaru</option><option value="date_asc">Terlama</option><option value="name">Nama</option><option value="status">Status</option></select>
      <select id="mch-size"><option value="10">10</option><option value="50">50</option><option value="100">100</option></select>
    </div><div id="mch-grid"></div><div id="mch-pager" class="m-pager"></div>`;
    target.querySelector('#mch-q').oninput = () => renderMch();
    target.querySelector('#mch-sort').onchange = () => renderMch();
    target.querySelector('#mch-size').onchange = () => renderMch();
  }
  let page = 1;
  function renderMch() {
    const q = (document.getElementById('mch-q')?.value || '').toLowerCase();
    const sort = document.getElementById('mch-sort')?.value || 'date_desc';
    const size = Number(document.getElementById('mch-size')?.value || 10);
    let rows = list.slice();
    if (q) rows = rows.filter(m => JSON.stringify(m).toLowerCase().includes(q));
    rows.sort((a, b) => {
      if (sort === 'name') return String(a.trade_name||'').localeCompare(String(b.trade_name||''));
      if (sort === 'status') return String(a.status||'').localeCompare(String(b.status||''));
      if (sort === 'date_asc') return String(a.created_at||'').localeCompare(String(b.created_at||''));
      return String(b.created_at||'').localeCompare(String(a.created_at||''));
    });
    const pages = Math.max(1, Math.ceil(rows.length / size));
    if (page > pages) page = pages;
    const slice = rows.slice((page - 1) * size, page * size);
    const grid = document.getElementById('mch-grid');
    grid.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr>
      <th>Nama Dagang</th><th>PIC</th><th>Email</th><th>Skala</th><th>Status</th><th>Saldo</th><th>Aksi</th>
    </tr></thead><tbody>` + (slice.map(m => `<tr>
      <td>${esc(m.trade_name)}</td><td>${esc(m.pic_name)}</td><td>${esc(m.email)}</td>
      <td>${esc((m.scale||'').toUpperCase())}</td><td>${esc(m.status)}</td>
      <td>Rp ${Number(m.balance||0).toLocaleString('id-ID')}</td>
      <td>
        <button type="button" class="btn btn-outline btn-sm" data-mch-card="${m.id}">Cetak / Unduh PDF</button>
        <button type="button" class="btn btn-outline btn-sm" data-mch-hold="${m.id}" data-st="${m.status==='on_hold'?'verified':'on_hold'}">${m.status==='on_hold'?'Aktifkan':'On-Hold'}</button>
      </td></tr>`).join('') || '<tr><td colspan="7">Belum ada merchant</td></tr>') + '</tbody></table></div>';
    grid.querySelectorAll('[data-mch-card]').forEach(b => b.onclick = () => {
      const tok = adminToken || sessionStorage.getItem('admin_token') || '';
      const url = API + '/admin/merchants/' + b.dataset.mchCard + '/card?token=' + encodeURIComponent(tok);
      window.open(url, '_blank');
    });
    grid.querySelectorAll('[data-mch-hold]').forEach(b => b.onclick = async () => {
      const r = await fetch(API + '/admin/merchants/' + b.dataset.mchHold + '/status', {
        method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status: b.dataset.st })
      });
      const j = await r.json();
      adminToast(j.message || '', j.success ? 'success' : 'error');
      if (j.success) loadMerchants();
    });
    const pager = document.getElementById('mch-pager');
    let ph = `<span style="font-size:.8rem;color:#64748b">${rows.length} merchant · ${page}/${pages}</span>`;
    for (let i = 1; i <= pages && i <= 15; i++) ph += `<button type="button" class="${i===page?'active':''}" data-p="${i}">${i}</button>`;
    pager.innerHTML = ph;
    pager.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { page = Number(b.dataset.p); renderMch(); });
  }
  renderMch();
}

async function loadAdminMessages() {
  const box = document.getElementById('adm-msg-list');
  if (!box) return;
  box.innerHTML = '<p style="color:#64748b">Memuat…</p>';
  try {
    const j = await adminJson(API + '/admin/messages', { headers: authHeaders() });
    box.innerHTML = (j.data || []).slice(0, 50).map(m =>
      `<div style="padding:10px;border:1px solid #e2e8f0;border-radius:8px;margin:8px 0;font-size:.85rem">
        <strong>${m.subject||''}</strong> <small>${(m.created_at||'').slice(0,16)} · ${m.from} → ${m.to}
        ${m.trade_name ? ' · ' + m.trade_name : ''} · ${m.merchant_id||''}</small>
        <p style="margin:6px 0 0">${(m.body||'').replace(/</g,'&lt;')}</p>
      </div>`
    ).join('') || '<p>Belum ada pesan</p>';
  } catch (e) {
    if (box) box.innerHTML = '<p style="color:#b91c1c">' + e.message + '</p>';
  }
}
document.getElementById('adm-msg-send')?.addEventListener('click', async () => {
  const body = {
    merchant_id: document.getElementById('adm-msg-mch')?.value.trim(),
    subject: document.getElementById('adm-msg-sub')?.value,
    body: document.getElementById('adm-msg-body')?.value
  };
  const r = await fetch(API + '/admin/messages', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  const j = await r.json();
  adminToast(j.message || '', j.success ? 'success' : 'error');
  if (j.success) loadAdminMessages();
});

async function loadIpLists() {
  try {
    const j = await adminJson(API + '/admin/ip-lists', { headers: authHeaders() });
    const d = j.data || { whitelist: [], blacklist: [] };
    const w = document.getElementById('ip-white');
    const b = document.getElementById('ip-black');
    if (w) w.value = (d.whitelist || []).join('\n');
    if (b) b.value = (d.blacklist || []).join('\n');
  } catch (e) {
    adminToast(e.message, 'error');
  }
}
document.getElementById('btn-save-iplists')?.addEventListener('click', async () => {
  const whitelist = document.getElementById('ip-white').value.split(/\n/).map(s => s.trim()).filter(Boolean);
  const blacklist = document.getElementById('ip-black').value.split(/\n/).map(s => s.trim()).filter(Boolean);
  const r = await fetch(API + '/admin/ip-lists', {
    method: 'PUT', headers: authHeaders(),
    body: JSON.stringify({ whitelist, blacklist })
  });
  const j = await r.json();
  document.getElementById('iplists-msg').innerHTML =
    '<div class="alert alert-success">' + (j.message || 'OK') + '</div>';
  adminToast('IP lists disimpan', 'success');
});

async function loadMerchantLimits() {
  const el = document.getElementById('mch-limits-form');
  if (!el) return;
  let data = { mikro: {}, kecil: {}, menengah: {} };
  try {
    const j = await adminJson(API + '/admin/merchant-limits', { headers: authHeaders() });
    data = j.data || data;
  } catch (e) {
    el.innerHTML = '<p class="text-danger">' + escHtml(e.message) + '</p>';
    return;
  }
  const scales = ['mikro', 'kecil', 'menengah'];
  el.innerHTML = scales.map(function (sc) {
    const d = data[sc] || {};
    return '<div class="card-panel" style="margin-bottom:12px">' +
      '<h3 style="margin-top:0;text-transform:capitalize">' + sc + '</h3>' +
      '<div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '<div class="form-group"><label>Max per transaksi (Rp)</label>' +
      '<input id="lim-' + sc + '-tx" value="' + Number(d.max_per_transfer || 0).toLocaleString('id-ID') + '" inputmode="numeric"></div>' +
      '<div class="form-group"><label>Max per hari (Rp)</label>' +
      '<input id="lim-' + sc + '-day" value="' + Number(d.max_per_day || 0).toLocaleString('id-ID') + '" inputmode="numeric"></div>' +
      '</div></div>';
  }).join('') +
    '<button type="button" class="btn btn-primary" id="btn-save-mch-limits">Simpan Limit</button>' +
    '<div id="mch-limits-msg" style="margin-top:10px"></div>';
  document.getElementById('btn-save-mch-limits').onclick = async function () {
    const body = {};
    scales.forEach(function (sc) {
      body[sc] = {
        max_per_transfer: Number(String(document.getElementById('lim-' + sc + '-tx').value).replace(/\D/g, '')) || 0,
        max_per_day: Number(String(document.getElementById('lim-' + sc + '-day').value).replace(/\D/g, '')) || 0,
        max_bulk: 10
      };
    });
    const r = await fetch(API + '/admin/merchant-limits', {
      method: 'PUT', headers: authHeaders(), body: JSON.stringify(body)
    });
    const j = await r.json();
    adminToast(j.message || '', j.success ? 'success' : 'error');
  };
}


async function loadMlSettings() {
  try {
    const r = await fetch(API + '/ml', { headers: adminHeaders() });
    const j = await r.json();
    const d = j.data || {};
    const f = d.fraud || {};
    const w = f.weights || {};
    const el = (id) => document.getElementById(id);
    if (el('ml_enabled')) el('ml_enabled').checked = d.enabled !== false;
    if (el('ml_low_amount')) el('ml_low_amount').value = f.low_amount_threshold ?? 50000;
    if (el('ml_low_count')) el('ml_low_count').value = f.low_amount_count ?? 10;
    if (el('ml_low_win')) el('ml_low_win').value = f.low_amount_window_min ?? 15;
    if (el('ml_burst_count')) el('ml_burst_count').value = f.burst_count ?? 10;
    if (el('ml_burst_win')) el('ml_burst_win').value = f.burst_window_min ?? 15;
    if (el('ml_same_count')) el('ml_same_count').value = f.same_account_count ?? 10;
    if (el('ml_same_win')) el('ml_same_win').value = f.same_account_window_min ?? 60;
    if (el('ml_w_low')) el('ml_w_low').value = w.low_amount_burst ?? 2;
    if (el('ml_w_burst')) el('ml_w_burst').value = w.tx_burst ?? 2;
    if (el('ml_w_same')) el('ml_w_same').value = w.same_account ?? 2;
    if (el('ml_w_device')) el('ml_w_device').value = w.new_device ?? 1;
    if (el('ml_w_loc')) el('ml_w_loc').value = w.new_location ?? 1;
    if (el('ml_thief')) el('ml_thief').checked = (d.thief && d.thief.enabled) !== false;
    if (el('ml_warn')) el('ml_warn').value = (d.actions && d.actions.warn_from_risk) || 3;
    if (el('ml_hold')) el('ml_hold').value = (d.actions && d.actions.hold_from_risk) || 4;
    if (el('ml_adaptive')) el('ml_adaptive').checked = (d.learning && d.learning.adaptive) !== false;
  } catch (e) { console.error(e); }
}
document.getElementById('btn-save-ml')?.addEventListener('click', async () => {
  const el = (id) => document.getElementById(id);
  const body = {
    enabled: el('ml_enabled')?.checked,
    fraud: {
      low_amount_threshold: Number(el('ml_low_amount')?.value),
      low_amount_count: Number(el('ml_low_count')?.value),
      low_amount_window_min: Number(el('ml_low_win')?.value),
      burst_count: Number(el('ml_burst_count')?.value),
      burst_window_min: Number(el('ml_burst_win')?.value),
      same_account_count: Number(el('ml_same_count')?.value),
      same_account_window_min: Number(el('ml_same_win')?.value),
      weights: {
        low_amount_burst: Number(el('ml_w_low')?.value),
        tx_burst: Number(el('ml_w_burst')?.value),
        same_account: Number(el('ml_w_same')?.value),
        new_device: Number(el('ml_w_device')?.value),
        new_location: Number(el('ml_w_loc')?.value)
      }
    },
    thief: { enabled: el('ml_thief')?.checked },
    actions: { warn_from_risk: Number(el('ml_warn')?.value), hold_from_risk: Number(el('ml_hold')?.value) },
    learning: { adaptive: el('ml_adaptive')?.checked }
  };
  const r = await fetch(API + '/ml', { method: 'PUT', headers: { ...adminHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  adminToast(j.message || (j.success ? 'Tersimpan' : 'Gagal'), j.success ? 'success' : 'error');
});

let _riskData = [];
let _riskPage = 0;
let _riskSort = { key: 'risk', dir: -1 };
async function loadActivityRisk() {
  const r = await fetch(API + '/activity-risk', { headers: adminHeaders() });
  const j = await r.json();
  _riskData = j.data || [];
  _riskPage = 0;
  renderRiskTable();
}
function renderRiskTable() {
  const q = (document.getElementById('risk-q')?.value || '').toLowerCase();
  let list = _riskData.filter(x => !q || String(x.email||'').toLowerCase().includes(q) || String(x.phone||'').includes(q));
  const k = _riskSort.key;
  list.sort((a,b) => {
    const av = a[k], bv = b[k];
    if (typeof av === 'number') return (av - bv) * _riskSort.dir;
    return String(av).localeCompare(String(bv)) * _riskSort.dir;
  });
  const size = Number(document.getElementById('risk-page-size')?.value || 10);
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / size));
  if (_riskPage >= pages) _riskPage = pages - 1;
  const slice = list.slice(_riskPage * size, _riskPage * size + size);
  const tb = document.querySelector('#risk-table tbody');
  if (!tb) return;
  tb.innerHTML = slice.map(row => {
    const riskColor = row.risk >= 4 ? '#e11d48' : row.risk >= 3 ? '#f59e0b' : '#16a34a';
    const holdBtn = row.type === 'Pengguna'
      ? `<button type="button" class="btn btn-sm btn-outline" data-hold-user="${row.id}" data-st="${row.status==='on_hold'?'active':'on_hold'}">${row.status==='on_hold'?'Aktifkan':'On-Hold'}</button>`
      : `<button type="button" class="btn btn-sm btn-outline" data-hold-mch="${row.id}" data-st="${row.status==='on_hold'?'verified':'on_hold'}">${row.status==='on_hold'?'Aktifkan':'On-Hold'}</button>`;
    return `<tr>
      <td>${escHtml(row.email)}</td><td>${escHtml(row.phone||'')}</td><td>${escHtml(row.type)}</td>
      <td style="font-weight:800;color:${riskColor}">${row.risk}</td>
      <td>${escHtml(row.status||'')}</td>
      <td style="font-size:12px;max-width:220px">${escHtml((row.factors||[]).join('; '))}</td>
      <td>${holdBtn}</td></tr>`;
  }).join('') || '<tr><td colspan="7">Tidak ada data</td></tr>';
  const pager = document.getElementById('risk-pager');
  if (pager) pager.innerHTML = `<button class="btn btn-sm btn-outline" id="risk-prev" ${_riskPage<=0?'disabled':''}>Prev</button>
    <span>Hal ${_riskPage+1}/${pages} (${total})</span>
    <button class="btn btn-sm btn-outline" id="risk-next" ${_riskPage>=pages-1?'disabled':''}>Next</button>`;
  document.getElementById('risk-prev')?.addEventListener('click', () => { _riskPage--; renderRiskTable(); });
  document.getElementById('risk-next')?.addEventListener('click', () => { _riskPage++; renderRiskTable(); });
  tb.querySelectorAll('[data-hold-user]').forEach(btn => btn.onclick = async () => {
    await fetch(API + '/users/' + btn.dataset.holdUser + '/status', { method: 'PUT', headers: { ...adminHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ status: btn.dataset.st }) });
    loadActivityRisk();
  });
  tb.querySelectorAll('[data-hold-mch]').forEach(btn => btn.onclick = async () => {
    await fetch(API + '/merchants/' + btn.dataset.holdMch + '/status', { method: 'PUT', headers: { ...adminHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ status: btn.dataset.st }) });
    loadActivityRisk();
  });
}
document.getElementById('btn-risk-reload')?.addEventListener('click', loadActivityRisk);
document.getElementById('risk-q')?.addEventListener('input', () => { _riskPage = 0; renderRiskTable(); });
document.getElementById('risk-page-size')?.addEventListener('change', () => { _riskPage = 0; renderRiskTable(); });

document.querySelectorAll('[data-section="ml"]').forEach(a => a.addEventListener('click', () => setTimeout(loadMlSettings, 50)));
document.querySelectorAll('[data-section="activity-risk"]').forEach(a => a.addEventListener('click', () => setTimeout(loadActivityRisk, 50)));


document.getElementById('btn-save-google')?.addEventListener('click', async () => {
  const cur = await fetch(API + '/admin/settings', { headers: authHeaders() }).then(r => r.json());
  const data = cur.data || {};
  if (document.getElementById('cms_favicon')?.value) {
      data.cms = data.cms || {};
      data.cms.favicon = document.getElementById('cms_favicon').value;
    }
    data.google = {
    client_id: document.getElementById('google_client_id')?.value?.trim() || '',
    enabled: document.getElementById('google_enabled')?.checked !== false
  };
  const r = await fetch(API + '/admin/settings', { method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const j = await r.json();
  if (typeof adminToast === 'function') adminToast(j.success ? 'Google OAuth disimpan' : (j.message || 'Gagal'), j.success ? 'success' : 'error');
});
document.querySelectorAll('[data-section="settings"]').forEach(a => a.addEventListener('click', async () => {
  try {
    const r0 = await fetch(API + '/admin/settings', { headers: authHeaders() });
    const j0 = await r0.json();
    const g = (j0.data && j0.data.google) || {};
    if (document.getElementById('google_client_id')) document.getElementById('google_client_id').value = g.client_id || '';
    if (document.getElementById('google_enabled')) document.getElementById('google_enabled').checked = g.enabled !== false;
  } catch (_) {}
}));

// CMS Google OAuth
document.getElementById('btn-save-cms')?.addEventListener('click', async () => {
  try {
    const cur = await fetch(API + '/admin/settings', { headers: authHeaders() }).then(r => r.json());
    const data = cur.data || {};
    // existing cms fields if present
    if (document.getElementById('seo_title')) {
      data.cms = data.cms || {};
      data.cms.seo_title = document.getElementById('seo_title')?.value || '';
      data.cms.seo_desc = document.getElementById('seo_desc')?.value || '';
    }
    if (document.getElementById('cms_favicon')?.value) {
      data.cms = data.cms || {};
      data.cms.favicon = document.getElementById('cms_favicon').value;
    }
    data.google = {
      client_id: document.getElementById('google_client_id_cms')?.value?.trim() || document.getElementById('google_client_id')?.value?.trim() || '',
      enabled: (document.getElementById('google_enabled_cms') || document.getElementById('google_enabled'))?.checked !== false,
      mode: document.getElementById('google_mode_cms')?.value || 'live'
    };
    if (document.getElementById('admin_user_cms')?.value) {
      data.admin = data.admin || {};
      data.admin.username = document.getElementById('admin_user_cms').value.trim();
      const pw = document.getElementById('admin_pass_cms')?.value;
      if (pw) data.admin.password = pw;
    }
    const r = await fetch(API + '/admin/settings', {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const j = await r.json();
    const msg = document.getElementById('cms-msg');
    if (msg) msg.innerHTML = '<div class="alert alert-'+(j.success?'success':'error')+'">'+(j.success?'CMS & Google OAuth disimpan':'Gagal')+'</div>';
    if (typeof adminToast === 'function') adminToast(j.success ? 'Tersimpan' : 'Gagal', j.success ? 'success' : 'error');
  } catch (e) {
    if (typeof adminToast === 'function') adminToast('Gagal simpan', 'error');
  }
}, true);

document.querySelectorAll('[data-section="cms"]').forEach(a => a.addEventListener('click', async () => {
  try {
    const r0 = await fetch(API + '/admin/settings', { headers: authHeaders() });
    const j0 = await r0.json();
    const g = (j0.data && j0.data.google) || {};
    if (document.getElementById('google_client_id_cms')) document.getElementById('google_client_id_cms').value = g.client_id || '';
    const fav = (j0.data && j0.data.cms && j0.data.cms.favicon) || '';
    if (document.getElementById('cms_favicon')) document.getElementById('cms_favicon').value = fav;
    if (document.getElementById('cms_favicon_preview') && fav) document.getElementById('cms_favicon_preview').src = fav;
    if (document.getElementById('google_enabled_cms')) document.getElementById('google_enabled_cms').checked = g.enabled !== false;
    if (document.getElementById('google_mode_cms')) document.getElementById('google_mode_cms').value = g.mode || 'live';
  } catch (_) {}
}));

document.getElementById('cms_favicon_file')?.addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  if (f.size > 200 * 1024) { if (typeof adminToast==='function') adminToast('Max 200KB','error'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById('cms_favicon').value = reader.result;
    const prev = document.getElementById('cms_favicon_preview');
    if (prev) prev.src = reader.result;
  };
  reader.readAsDataURL(f);
});


/* ========== Database / i18n / SMTP / SMS / AI / Audible ========== */
function fieldRow(label, inputHtml) {
  return '<label style="display:block;margin:10px 0 4px;font-size:.85rem;font-weight:600">' + label + '</label>' + inputHtml;
}

async function loadDatabases() {
  const box = document.getElementById('db-panel');
  if (!box) return;
  box.innerHTML = 'Memuat…';
  try {
    const j = await adminJson(API + '/admin/databases', { headers: authHeaders() });
    const d = j.data || {};
    const fm = d.feature_map || {};
    const features = Object.keys(fm);
    box.innerHTML = `
      <h3>Backend</h3>
      <label><input type="checkbox" id="db-json" ${d.json?.enabled!==false?'checked':''}> JSON Store (selalu direkomendasikan default)</label><br>
      <label><input type="checkbox" id="db-lowdb" ${d.lowdb?.enabled!==false?'checked':''}> Lowdb</label><br>
      <label><input type="checkbox" id="db-mongo" ${d.mongodb?.enabled?'checked':''}> MongoDB Atlas</label>
      ${fieldRow('MongoDB URI', '<input id="db-mongo-uri" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0" value="'+esc(d.mongodb?.uri||'')+'">')}
      ${fieldRow('DB Name', '<input id="db-mongo-name" value="'+esc(d.mongodb?.db_name||'bdpay')+'" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0">')}
      <label style="margin-top:12px;display:block"><input type="checkbox" id="db-sb" ${d.supabase?.enabled?'checked':''}> Supabase</label>
      ${fieldRow('Supabase URL', '<input id="db-sb-url" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0" value="'+esc(d.supabase?.url||'')+'">')}
      ${fieldRow('Service Key', '<input id="db-sb-key" type="password" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0" value="'+esc(d.supabase?.service_key||'')+'">')}
      <h3 style="margin-top:20px">Mapping Fitur → Database</h3>
      <table style="width:100%;font-size:.85rem"><thead><tr><th>Fitur</th><th>Backend</th></tr></thead><tbody>
      ${features.map(f => `<tr><td>${esc(f)}</td><td><select data-fm="${esc(f)}">
        ${['json','lowdb','mongodb','supabase'].map(b => `<option value="${b}" ${fm[f]===b?'selected':''}>${b}</option>`).join('')}
      </select></td></tr>`).join('')}
      </tbody></table>
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn btn-primary" id="db-save">Simpan</button>
        <button type="button" class="btn btn-outline" id="db-test-lowdb">Test Lowdb</button>
        <button type="button" class="btn btn-outline" id="db-test-mongo">Test MongoDB</button>
        <button type="button" class="btn btn-outline" id="db-test-sb">Test Supabase</button>
      </div>`;
    document.getElementById('db-save').onclick = async () => {
      const feature_map = {};
      box.querySelectorAll('[data-fm]').forEach(sel => { feature_map[sel.dataset.fm] = sel.value; });
      const body = {
        json: { enabled: document.getElementById('db-json').checked },
        lowdb: { enabled: document.getElementById('db-lowdb').checked },
        mongodb: {
          enabled: document.getElementById('db-mongo').checked,
          uri: document.getElementById('db-mongo-uri').value.trim(),
          db_name: document.getElementById('db-mongo-name').value.trim() || 'bdpay'
        },
        supabase: {
          enabled: document.getElementById('db-sb').checked,
          url: document.getElementById('db-sb-url').value.trim(),
          service_key: document.getElementById('db-sb-key').value.trim()
        },
        feature_map
      };
      const r = await fetch(API + '/admin/databases', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
      const j2 = await r.json();
      adminToast(j2.message || '', j2.success ? 'success' : 'error');
    };
    const test = async (kind) => {
      const r = await fetch(API + '/admin/databases/test', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ kind }) });
      const j2 = await r.json();
      adminToast(j2.message || '', j2.success ? 'success' : 'error');
    };
    document.getElementById('db-test-lowdb').onclick = () => test('lowdb');
    document.getElementById('db-test-mongo').onclick = () => test('mongodb');
    document.getElementById('db-test-sb').onclick = () => test('supabase');
  } catch (e) {
    box.innerHTML = '<p style="color:#b91c1c">' + esc(e.message) + '</p>';
  }
}

async function loadI18n() {
  const box = document.getElementById('i18n-panel');
  if (!box) return;
  const j = await adminJson(API + '/admin/i18n', { headers: authHeaders() });
  const d = j.data || {};
  const dict = d.dict || { id: {}, en: {}, cn: {} };
  const keys = Array.from(new Set([...Object.keys(dict.id||{}), ...Object.keys(dict.en||{}), ...Object.keys(dict.cn||{})])).sort();
  box.innerHTML = `
    <div class="card-panel" style="padding:0;border:0;box-shadow:none">
    <label class="chk-label" style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><input type="checkbox" id="i18n-en" ${d.enabled!==false?'checked':''}> <span>Aktifkan multi-bahasa</span></label>
    ${fieldRow('Bahasa default', '<select id="i18n-default" class="admin-input" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid #cbd5e1;background:#f8fafc"><option value="id">Indonesia</option><option value="en">English</option><option value="cn">中文</option></select>')}
    <div style="overflow:auto;max-height:420px;margin-top:12px">
      <table style="width:100%;font-size:.8rem"><thead><tr><th>Key</th><th>ID</th><th>EN</th><th>CN</th></tr></thead>
      <tbody id="i18n-rows">${keys.map(k => `<tr>
        <td><code>${esc(k)}</code></td>
        <td><input class="admin-input" data-lang="id" data-key="${esc(k)}" value="${esc(dict.id?.[k]||'')}" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #e2e8f0;background:#fff"></td>
        <td><input class="admin-input" data-lang="en" data-key="${esc(k)}" value="${esc(dict.en?.[k]||'')}" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #e2e8f0;background:#fff"></td>
        <td><input class="admin-input" data-lang="cn" data-key="${esc(k)}" value="${esc(dict.cn?.[k]||'')}" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #e2e8f0;background:#fff"></td>
      </tr>`).join('')}</tbody></table>
    </div>
    <div style="margin-top:10px;display:flex;gap:8px">
      <input id="i18n-newkey" class="admin-input" placeholder="key baru" style="padding:10px 12px;border-radius:10px;border:1px solid #cbd5e1;background:#f8fafc;min-width:160px">
      <button type="button" class="btn btn-outline" id="i18n-add">+ Key</button>
      <button type="button" class="btn btn-primary" id="i18n-save">Simpan</button>
    </div>`;
  document.getElementById('i18n-default').value = d.default_lang || 'id';
  document.getElementById('i18n-add').onclick = () => {
    const k = document.getElementById('i18n-newkey').value.trim();
    if (!k) return;
    const tb = document.getElementById('i18n-rows');
    tb.insertAdjacentHTML('beforeend', `<tr>
      <td><code>${esc(k)}</code></td>
      <td><input data-lang="id" data-key="${esc(k)}" style="width:100%"></td>
      <td><input data-lang="en" data-key="${esc(k)}" style="width:100%"></td>
      <td><input data-lang="cn" data-key="${esc(k)}" style="width:100%"></td>
    </tr>`);
  };
  document.getElementById('i18n-save').onclick = async () => {
    const dict2 = { id: {}, en: {}, cn: {} };
    box.querySelectorAll('input[data-lang]').forEach(inp => {
      dict2[inp.dataset.lang][inp.dataset.key] = inp.value;
    });
    const r = await fetch(API + '/admin/i18n', {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ enabled: document.getElementById('i18n-en').checked, default_lang: document.getElementById('i18n-default').value, dict: dict2 })
    });
    const j2 = await r.json();
    adminToast(j2.message || '', j2.success ? 'success' : 'error');
  };
}

async function loadSmtp() {
  const box = document.getElementById('smtp-panel');
  if (!box) return;
  const j = await adminJson(API + '/admin/smtp', { headers: authHeaders() });
  const d = j.data || {};
  box.innerHTML = `
    <label><input type="checkbox" id="smtp-en" ${d.enabled?'checked':''}> Aktifkan SMTP</label>
    <label style="display:block;margin-top:8px"><input type="checkbox" id="smtp-web" ${d.web_email_enabled?'checked':''}> Web Email (kirim via browser/API alternatif)</label>
    ${fieldRow('Host', '<input id="smtp-host" value="'+esc(d.host||'')+'" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0">')}
    ${fieldRow('Port', '<input id="smtp-port" type="number" value="'+(d.port||587)+'" style="width:120px;padding:8px;border-radius:8px;border:1px solid #e2e8f0">')}
    <label><input type="checkbox" id="smtp-secure" ${d.secure?'checked':''}> Secure (TLS)</label>
    ${fieldRow('User', '<input id="smtp-user" value="'+esc(d.user||'')+'" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0">')}
    ${fieldRow('Password', '<input id="smtp-pass" type="password" value="'+esc(d.pass||'')+'" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0">')}
    ${fieldRow('From', '<input id="smtp-from" value="'+esc(d.from||'')+'" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0">')}
    <div style="margin-top:12px;display:flex;gap:8px">
      <button type="button" class="btn btn-primary" id="smtp-save">Simpan</button>
      <button type="button" class="btn btn-outline" id="smtp-test">Kirim Email Uji</button>
    </div>`;
  document.getElementById('smtp-save').onclick = async () => {
    const body = {
      enabled: document.getElementById('smtp-en').checked,
      web_email_enabled: document.getElementById('smtp-web').checked,
      host: document.getElementById('smtp-host').value.trim(),
      port: Number(document.getElementById('smtp-port').value) || 587,
      secure: document.getElementById('smtp-secure').checked,
      user: document.getElementById('smtp-user').value.trim(),
      pass: document.getElementById('smtp-pass').value,
      from: document.getElementById('smtp-from').value.trim()
    };
    const r = await fetch(API + '/admin/smtp', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
    const j2 = await r.json();
    adminToast(j2.message || '', j2.success ? 'success' : 'error');
  };
  document.getElementById('smtp-test').onclick = async () => {
    const r = await fetch(API + '/admin/smtp/test', { method: 'POST', headers: authHeaders(), body: '{}' });
    const j2 = await r.json();
    adminToast(j2.message || '', j2.success ? 'success' : 'error');
  };
}

async function loadSms() {
  const box = document.getElementById('sms-panel');
  if (!box) return;
  const j = await adminJson(API + '/admin/sms-gateway', { headers: authHeaders() });
  const d = j.data || {};
  box.innerHTML = `
    <label><input type="checkbox" id="sms-en" ${d.enabled?'checked':''}> Aktifkan SMS Gateway</label>
    ${fieldRow('Provider', '<select id="sms-prov"><option value="simulation">Simulasi</option><option value="twilio">Twilio</option><option value="nexmo">Nexmo/Vonage</option><option value="custom">Custom HTTP</option></select>')}
    ${fieldRow('API Key', '<input id="sms-key" value="'+esc(d.api_key||'')+'" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0">')}
    ${fieldRow('API Secret', '<input id="sms-secret" type="password" value="'+esc(d.api_secret||'')+'" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0">')}
    ${fieldRow('Sender ID', '<input id="sms-sender" value="'+esc(d.sender_id||'bdPay')+'" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0">')}
    ${fieldRow('Base URL (custom)', '<input id="sms-url" value="'+esc(d.base_url||'')+'" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0">')}
    ${fieldRow('Template OTP', '<input id="sms-tpl" value="'+esc(d.otp_template||'')+'" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0">')}
    <button type="button" class="btn btn-primary" id="sms-save" style="margin-top:12px">Simpan</button>`;
  document.getElementById('sms-prov').value = d.provider || 'simulation';
  document.getElementById('sms-save').onclick = async () => {
    const body = {
      enabled: document.getElementById('sms-en').checked,
      provider: document.getElementById('sms-prov').value,
      api_key: document.getElementById('sms-key').value.trim(),
      api_secret: document.getElementById('sms-secret').value,
      sender_id: document.getElementById('sms-sender').value.trim(),
      base_url: document.getElementById('sms-url').value.trim(),
      otp_template: document.getElementById('sms-tpl').value
    };
    const r = await fetch(API + '/admin/sms-gateway', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
    const j2 = await r.json();
    adminToast(j2.message || '', j2.success ? 'success' : 'error');
  };
}

async function loadAiSettings() {
  const box = document.getElementById('ai-panel');
  if (!box) return;
  const j = await adminJson(API + '/admin/ai', { headers: authHeaders() });
  const d = j.data || {};
  const p = d.providers || {};
  const defaultPrio = ['openai','grok','gemini','groq','google_ai_studio','deepseek','qwen','other'];
  const provForm = (name, label, hint) => {
    const c = p[name] || {};
    return `<div style="border:1px solid #e2e8f0;border-radius:12px;padding:12px;margin:10px 0;background:linear-gradient(180deg,#fff,#f8fafc)">
      <strong>${label}</strong>
      ${hint ? '<p style="margin:4px 0 0;font-size:.75rem;color:#64748b">' + hint + '</p>' : ''}
      <label style="display:block;margin-top:6px"><input type="checkbox" id="ai-${name}-en" ${c.enabled?'checked':''}> Aktif</label>
      ${fieldRow('API Key', '<input id="ai-'+name+'-key" type="password" value="'+esc(c.api_key||'')+'" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0" placeholder="sk-... / gsk_... / ...">')}
      ${fieldRow('Model', '<input id="ai-'+name+'-model" value="'+esc(c.model||'')+'" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0">')}
      ${fieldRow('Base URL', '<input id="ai-'+name+'-url" value="'+esc(c.base_url||'')+'" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0">')}
    </div>`;
  };
  box.innerHTML = `
    <label><input type="checkbox" id="ai-en" ${d.enabled!==false?'checked':''}> Aktifkan AI</label>
    <label style="display:block;margin-top:6px"><input type="checkbox" id="ai-par" ${d.run_parallel?'checked':''}> Jalankan provider bersamaan (parallel)</label>
    ${fieldRow('Prioritas (urutan, koma)', '<input id="ai-prio" value="'+esc((d.priority||defaultPrio).join(','))+'" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0">')}
    <p style="font-size:.78rem;color:#64748b;margin:4px 0 12px">Default: openai, grok, gemini, groq, google_ai_studio, deepseek, qwen, other</p>
    <h3>Tasks</h3>
    <label><input type="checkbox" id="ai-t-op" ${d.tasks?.operational!==false?'checked':''}> Efisiensi Operasional</label>
    <label style="display:block"><input type="checkbox" id="ai-t-cy" ${d.tasks?.cyber!==false?'checked':''}> Cyber Defense</label>
    <label style="display:block"><input type="checkbox" id="ai-t-as" ${d.tasks?.assistance!==false?'checked':''}> Assistance Pengguna</label>
    <label style="display:block"><input type="checkbox" id="ai-t-ocr" ${d.tasks?.ocr_assist!==false?'checked':''}> Assist OCR KYC</label>
    <label style="display:block"><input type="checkbox" id="ai-t-mon" ${d.tasks?.monitoring!==false?'checked':''}> Monitoring Transaksi/Anomali</label>
    ${provForm('openai','OpenAI', 'platform.openai.com — model gpt-4o-mini')}
    ${provForm('grok','Grok (xAI)', 'console.x.ai — model grok-3-mini')}
    ${provForm('gemini','Gemini (Google)', 'aistudio.google.com / Google AI — generateContent')}
    ${provForm('groq','Groq AI', 'console.groq.com — OpenAI-compatible, llama-3.3-70b-versatile')}
    ${provForm('google_ai_studio','Google AI Studio', 'aistudio.google.com API key — endpoint Generative Language')}
    ${provForm('deepseek','DeepSeek', 'platform.deepseek.com — deepseek-chat')}
    ${provForm('qwen','Qwen (Alibaba DashScope)', 'dashscope.aliyun.com / intl compatible-mode — qwen-plus')}
    ${provForm('other','Other (Custom OpenAI-compatible)', 'Base URL wajib diisi')}
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" class="btn btn-primary" id="ai-save">Simpan AI Settings</button>
      <button type="button" class="btn btn-outline" id="ai-test">Test AI</button>
    </div>
    <pre id="ai-out" style="margin-top:12px;max-height:220px;overflow:auto;background:#0f172a;color:#e2e8f0;padding:12px;border-radius:12px;font-size:.75rem"></pre>`;
  document.getElementById('ai-save').onclick = async () => {
    const names = ['openai','grok','gemini','groq','google_ai_studio','deepseek','qwen','other'];
    const providers = {};
    names.forEach(n => {
      providers[n] = {
        enabled: !!document.getElementById('ai-' + n + '-en')?.checked,
        api_key: document.getElementById('ai-' + n + '-key')?.value || '',
        model: document.getElementById('ai-' + n + '-model')?.value || '',
        base_url: document.getElementById('ai-' + n + '-url')?.value || ''
      };
    });
    const body = {
      enabled: document.getElementById('ai-en').checked,
      run_parallel: document.getElementById('ai-par').checked,
      priority: String(document.getElementById('ai-prio').value || '').split(',').map(x => x.trim()).filter(Boolean),
      tasks: {
        operational: document.getElementById('ai-t-op').checked,
        cyber: document.getElementById('ai-t-cy').checked,
        assistance: document.getElementById('ai-t-as').checked,
        ocr_assist: document.getElementById('ai-t-ocr').checked,
        monitoring: document.getElementById('ai-t-mon').checked
      },
      providers
    };
    const r = await fetch(API + '/admin/ai', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
    const j2 = await r.json();
    adminToast(j2.message || '', j2.success ? 'success' : 'error');
  };
  document.getElementById('ai-test').onclick = async () => {
    adminToast('Menjalankan test AI…', 'info');
    const r = await fetch(API + '/admin/ai/run', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ task: 'general', prompt: 'Balas singkat: bdPay AI live OK', system: 'Jawab satu kalimat.' })
    });
    const j2 = await r.json();
    document.getElementById('ai-out').textContent = JSON.stringify(j2, null, 2);
  };
}

async function loadAudible() {
  const box = document.getElementById('audible-panel');
  if (!box) return;
  const j = await adminJson(API + '/admin/audible', { headers: authHeaders() });
  const d = j.data || {};
  box.innerHTML = `
    <label><input type="checkbox" id="aud-en" ${d.enabled!==false?'checked':''}> Aktifkan Audible</label>
    <label style="display:block;margin-top:6px"><input type="checkbox" id="aud-land" ${d.show_on_landing!==false?'checked':''}> Tampil di Halaman Muka</label>
    <label style="display:block"><input type="checkbox" id="aud-pwa" ${d.show_on_pwa!==false?'checked':''}> Tampil di PWA (setelah login)</label>
    <label style="display:block"><input type="checkbox" id="aud-mch" ${d.show_on_merchant!==false?'checked':''}> Tampil di Merchant (setelah login)</label>
    <label style="display:block"><input type="checkbox" id="aud-ai" ${d.ai_assistance!==false?'checked':''}> AI Assistance</label>
    ${fieldRow('TTS Lang', '<input id="aud-lang" value="'+esc(d.tts_lang||'id-ID')+'" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0">')}
    <button type="button" class="btn btn-primary" id="aud-save" style="margin-top:12px">Simpan</button>`;
  document.getElementById('aud-save').onclick = async () => {
    const body = {
      enabled: document.getElementById('aud-en').checked,
      show_on_landing: document.getElementById('aud-land').checked,
      show_on_pwa: document.getElementById('aud-pwa').checked,
      show_on_merchant: document.getElementById('aud-mch').checked,
      ai_assistance: document.getElementById('aud-ai').checked,
      tts_lang: document.getElementById('aud-lang').value.trim() || 'id-ID'
    };
    const r = await fetch(API + '/admin/audible', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
    const j2 = await r.json();
    adminToast(j2.message || '', j2.success ? 'success' : 'error');
  };
}

document.addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'btn-refresh-price-compare') {
    try {
      const r = await fetch(API + '/admin/price-compare/refresh', { method: 'POST', headers: authHeaders(), body: '{}' });
      const j = await r.json();
      adminToast(j.message || (j.success ? 'Komparasi diperbarui' : 'Gagal'), j.success ? 'success' : 'error');
    } catch (err) {
      adminToast(err.message || 'Gagal refresh', 'error');
    }
  }
});

async function loadAiActivity() {
  const box = document.getElementById('ai-activity-panel');
  if (!box) return;
  box.innerHTML = 'Memuat…';
  try {
    const j = await adminJson(API + '/admin/ai/activity?limit=150', { headers: authHeaders() });
    const rows = j.data || [];
    if (!rows.length) { box.innerHTML = '<p style="color:#64748b">Belum ada aktivitas AI.</p>'; return; }
    box.innerHTML = `<div style="overflow:auto"><table style="width:100%;font-size:.8rem;border-collapse:collapse">
      <thead><tr style="background:#f1f5f9"><th>Waktu</th><th>Task</th><th>Provider</th><th>OK</th><th>ms</th><th>Prompt</th><th>Respons</th></tr></thead>
      <tbody>${rows.map(r => `<tr style="border-bottom:1px solid #e2e8f0">
        <td style="white-space:nowrap">${esc((r.at||'').replace('T',' ').slice(0,19))}</td>
        <td><code>${esc(r.task)}</code></td>
        <td>${esc(r.provider||'-')}${r.simulation?' <small>(sim)</small>':''}</td>
        <td>${r.success?'✓':'✗'}</td>
        <td>${r.duration_ms||'-'}</td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis" title="${esc(r.prompt_preview||'')}">${esc(r.prompt_preview||'')}</td>
        <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis" title="${esc(r.text_preview||r.message||'')}">${esc(r.text_preview||r.message||'')}</td>
      </tr>`).join('')}</tbody></table></div>`;
  } catch (e) {
    box.innerHTML = '<p style="color:#b91c1c">' + esc(e.message) + '</p>';
  }
}

document.addEventListener('click', async (e) => {
  if (!e.target || !e.target.classList.contains('tnc-ai-btn')) return;
  const target = e.target.dataset.target;
  const ta = document.getElementById(target);
  if (!ta) return;
  const topic = e.target.dataset.topic || target;
  adminToast('AI menyusun teks…', 'info');
  try {
    const r = await fetch(API + '/admin/ai/run', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({
        task: 'operational',
        system: 'Anda legal copywriter fintech Indonesia. Tulis formal, jelas, sesuai hukum Indonesia. Output teks saja tanpa markdown berlebih.',
        prompt: 'Tulis atau perbaiki dokumen: ' + topic + '. Konteks existing:\\n' + (ta.value || '').slice(0, 2000)
      })
    });
    const j = await r.json();
    if (j.success && j.text) {
      ta.value = j.text;
      adminToast('Teks AI dimasukkan — review sebelum simpan', 'success');
    } else adminToast(j.message || 'AI gagal', 'error');
  } catch (err) {
    adminToast(err.message || 'Gagal', 'error');
  }
});

async function loadPreferredBanks() {
  const box = document.getElementById('pref-bank-panel');
  if (!box) return;
  const j = await adminJson(API + '/admin/preferred-banks', { headers: authHeaders() });
  const d = j.data || {};
  const codes = d.codes || ['bni', 'permata'];
  const all = ['bni','permata','bca','bri','mandiri','cimb','btn','danamon'];
  box.innerHTML = `
    <label class="chk-label"><input type="checkbox" id="pb-en" ${d.enabled!==false?'checked':''}> Aktifkan Preferred Bank</label>
    <p style="font-size:.85rem;color:#64748b;margin:10px 0">Centang bank yang tampil di grup <strong>⭐ Preferred</strong>.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">
      ${all.map(c => `<label style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:12px;background:linear-gradient(135deg,#ecfdf5,#eff6ff);border:1px solid #a7f3d0;font-weight:600">
        <input type="checkbox" data-pb="${c}" ${codes.includes(c)?'checked':''}> ${c.toUpperCase()}
      </label>`).join('')}
    </div>
    <button type="button" class="btn btn-primary" id="pb-save" style="margin-top:14px">Simpan Preferred Bank</button>`;
  document.getElementById('pb-save').onclick = async () => {
    const selected = [...box.querySelectorAll('[data-pb]:checked')].map(x => x.dataset.pb);
    const r = await fetch(API + '/admin/preferred-banks', {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ enabled: document.getElementById('pb-en').checked, codes: selected })
    });
    const j2 = await r.json();
    adminToast(j2.message || '', j2.success ? 'success' : 'error');
  };
}

async function loadRemittanceAdmin() {
  const box = document.getElementById('remittance-panel');
  if (!box) return;
  const j = await adminJson(API + '/admin/remittance', { headers: authHeaders() });
  const d = j.data || {};
  const prov = ['ria','moneygram','westernunion'];
  const labels = { ria: 'Ria Money Transfer', moneygram: 'MoneyGram', westernunion: 'Western Union' };
  box.innerHTML = `
    <div class="form-group"><label>Mode Global</label>
      <select id="rmt-mode" style="padding:10px;border-radius:10px;border:1px solid #cbd5e1">
        <option value="demo">Demo</option><option value="sandbox">Sandbox</option><option value="production">Production</option>
      </select>
    </div>
    ${prov.map(p => {
      const c = d[p] || {};
      return `<div style="margin:12px 0;padding:12px;border:1px solid #e2e8f0;border-radius:12px">
        <h3 style="margin:0 0 8px">${labels[p]}</h3>
        <label><input type="checkbox" id="rmt-${p}-en" ${c.active!==false?'checked':''}> Aktif</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
          <div><label>Mode</label><select id="rmt-${p}-mode"><option value="sandbox">Sandbox</option><option value="production">Production</option><option value="demo">Demo</option></select></div>
          <div><label>Limit default (USD)</label><input id="rmt-${p}-lim" type="number" value="${c.default_limit_usd||10000}" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0"></div>
        </div>
        <div style="margin-top:8px"><label>API Key</label><input id="rmt-${p}-key" type="password" value="${esc(c.api_key||'')}" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0"></div>
        <div style="margin-top:8px"><label>Base URL</label><input id="rmt-${p}-url" value="${esc(c.base_url||'')}" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0"></div>
      </div>`;
    }).join('')}
    <button type="button" class="btn btn-primary" id="rmt-save">Simpan Remittance</button>`;
  document.getElementById('rmt-mode').value = d.mode || 'sandbox';
  prov.forEach(p => {
    const el = document.getElementById('rmt-' + p + '-mode');
    if (el) el.value = (d[p] && d[p].mode) || 'sandbox';
  });
  document.getElementById('rmt-save').onclick = async () => {
    const body = { mode: document.getElementById('rmt-mode').value, priority: prov };
    prov.forEach(p => {
      body[p] = {
        active: document.getElementById('rmt-' + p + '-en').checked,
        mode: document.getElementById('rmt-' + p + '-mode').value,
        default_limit_usd: Number(document.getElementById('rmt-' + p + '-lim').value) || 10000,
        api_key: document.getElementById('rmt-' + p + '-key').value,
        base_url: document.getElementById('rmt-' + p + '-url').value.trim()
      };
    });
    const r = await fetch(API + '/admin/remittance', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
    const j2 = await r.json();
    adminToast(j2.message || '', j2.success ? 'success' : 'error');
  };
}





async function loadFaqs() {
  const el = document.getElementById('faqs-table');
  if (!el) return;
  el.innerHTML = '<p style="color:#64748b">Memuat FAQ…</p>';
  try {
    const j = await adminJson(API + '/admin/faqs', { headers: authHeaders() });
    const list = j.data || [];
    let html = '<div style="display:flex;justify-content:flex-end;margin-bottom:10px">' +
      '<button type="button" class="btn btn-primary btn-sm" id="btn-add-faq-inline">+ Tambah FAQ</button></div>';
    if (!list.length) {
      html += '<p class="wiz-hint" style="color:#64748b">Belum ada FAQ. Klik + Tambah FAQ.</p>';
    } else {
      html += '<div class="table-wrap"><table class="data-table admin-table"><thead><tr><th>#</th><th>Pertanyaan</th><th>Jawaban</th><th></th></tr></thead><tbody>';
      list.forEach((f, i) => {
        html += '<tr><td>' + (i + 1) + '</td><td>' + esc(f.question || f.q || '-') + '</td>' +
          '<td style="max-width:360px;font-size:.85rem">' + esc(String(f.answer || f.a || '').slice(0, 160)) + (String(f.answer || '').length > 160 ? '…' : '') + '</td>' +
          '<td style="white-space:nowrap">' +
          '<button type="button" class="btn btn-outline btn-sm" data-faq-edit="' + esc(f.id) + '">Edit</button> ' +
          '<button type="button" class="btn btn-outline btn-sm" data-faq-del="' + esc(f.id) + '">Hapus</button></td></tr>';
      });
      html += '</tbody></table></div>';
    }
    el.innerHTML = html;
    const openAdd = () => {
      document.getElementById('faq-id').value = '';
      document.getElementById('faq-q').value = '';
      document.getElementById('faq-a').value = '';
      document.getElementById('faq-modal-title').textContent = 'Tambah FAQ';
      document.getElementById('faq-modal')?.classList.remove('hidden');
    };
    document.getElementById('btn-add-faq-inline')?.addEventListener('click', openAdd);
    document.getElementById('btn-add-faq')?.addEventListener('click', openAdd);
    el.querySelectorAll('[data-faq-edit]').forEach(btn => {
      btn.onclick = () => {
        const f = list.find(x => x.id === btn.dataset.faqEdit);
        if (!f) return;
        document.getElementById('faq-id').value = f.id || '';
        document.getElementById('faq-q').value = f.question || f.q || '';
        document.getElementById('faq-a').value = f.answer || f.a || '';
        document.getElementById('faq-modal-title').textContent = 'Edit FAQ';
        document.getElementById('faq-modal')?.classList.remove('hidden');
      };
    });
    el.querySelectorAll('[data-faq-del]').forEach(btn => {
      btn.onclick = async () => {
        if (!(await adminConfirm('Hapus FAQ ini?'))) return;
        const r = await fetch(API + '/admin/faqs/' + encodeURIComponent(btn.dataset.faqDel), { method: 'DELETE', headers: authHeaders() });
        const j2 = await r.json();
        adminToast(j2.success ? 'FAQ dihapus' : (j2.message || 'Gagal'), j2.success ? 'success' : 'error');
        loadFaqs();
      };
    });
  } catch (e) {
    el.innerHTML = '<p class="alert alert-error">Gagal muat FAQ: ' + esc(e.message) + '</p>';
  }
}

function renderFeeItems(containerId, items, prefix) {
  const box = document.getElementById(containerId);
  if (!box) return;
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    box.innerHTML = '<p style="font-size:.85rem;color:#64748b">Belum ada item. Klik + Item.</p>';
  } else {
    box.innerHTML = list.map((it, i) => {
      const type = it.type === 'percent' ? 'percent' : 'fixed';
      return `<div class="fee-item-row" data-idx="${i}" style="display:grid;grid-template-columns:1.4fr 110px 120px 70px 40px;gap:8px;align-items:center;margin-bottom:8px;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px">
        <input data-f="name" value="${esc(it.name || '')}" placeholder="Nama biaya" style="padding:8px 10px;border-radius:8px;border:1px solid #cbd5e1">
        <select data-f="type" style="padding:8px;border-radius:8px;border:1px solid #cbd5e1">
          <option value="fixed" ${type==='fixed'?'selected':''}>Fixed (Rp)</option>
          <option value="percent" ${type==='percent'?'selected':''}>Persen (%)</option>
        </select>
        <input data-f="value" value="${esc(it.value != null ? it.value : 0)}" inputmode="decimal" style="padding:8px 10px;border-radius:8px;border:1px solid #cbd5e1">
        <label style="font-size:.8rem;display:flex;align-items:center;gap:4px"><input type="checkbox" data-f="active" ${it.active!==false?'checked':''}> Aktif</label>
        <button type="button" class="btn btn-outline btn-sm" data-fee-del="${i}" title="Hapus">✕</button>
      </div>`;
    }).join('');
  }
  box.querySelectorAll('[data-fee-del]').forEach(btn => {
    btn.onclick = () => {
      list.splice(Number(btn.dataset.feeDel), 1);
      renderFeeItems(containerId, list, prefix);
      box._items = list;
    };
  });
  box.querySelectorAll('.fee-item-row').forEach(row => {
    const i = Number(row.dataset.idx);
    row.querySelectorAll('[data-f]').forEach(inp => {
      const sync = () => {
        const f = inp.dataset.f;
        if (f === 'active') list[i].active = inp.checked;
        else if (f === 'value') list[i].value = Number(String(inp.value).replace(/,/g, '.')) || 0;
        else list[i][f] = inp.value;
        box._items = list;
      };
      inp.onchange = sync;
      inp.oninput = sync;
    });
  });
  box._items = list;
}

function collectFeeItems(containerId) {
  const box = document.getElementById(containerId);
  return (box && box._items) ? box._items : [];
}

async function loadFees() {
  try {
    const j = await adminJson(API + '/admin/fees', { headers: authHeaders() });
    const d = j.data || {};
    const svc = (d.service && d.service.items) || (d.ppob && d.ppob.items) || [];
    const mk = (d.markup && d.markup.items) || [];
    const tr = (d.transfer && d.transfer.items) || (d.domestic && d.domestic.items) || [
      { name: 'Biaya Admin', type: 'fixed', value: 500, active: true },
      { name: 'Biaya Layanan', type: 'percent', value: 1, active: true }
    ];
    renderFeeItems('fees-service-items', JSON.parse(JSON.stringify(svc)), 'svc');
    renderFeeItems('fees-markup-items', JSON.parse(JSON.stringify(mk)), 'mk');
    renderFeeItems('fees-transfer-items', JSON.parse(JSON.stringify(tr)), 'tr');
  } catch (e) {
    adminToast('Gagal muat biaya: ' + e.message, 'error');
  }
}

async function loadTaxes(keepLocal) {
  const box = document.getElementById('taxes-editor');
  if (!box) return;
  try {
    let items;
    if (keepLocal && (box._items || window.__taxItemsCache)) {
      items = box._items || window.__taxItemsCache;
    } else {
      const j = await adminJson(API + '/admin/taxes', { headers: authHeaders() });
      items = (j.data && j.data.items) || [];
      if (!items.length) {
        items.push({ id: 'tax-ppn', name: 'PPN', type: 'percent', value: 11, active: true, apply_to: 'all' });
      }
    }
    box._items = items;
    const render = () => {
      box.innerHTML = box._items.map((it, i) => `
        <div class="tax-row" data-i="${i}" style="display:grid;grid-template-columns:1.2fr 100px 100px 120px 70px 40px;gap:8px;align-items:center;margin-bottom:8px;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px">
          <input data-f="name" value="${esc(it.name||'')}" placeholder="Nama pajak" style="padding:8px;border-radius:8px;border:1px solid #cbd5e1">
          <select data-f="type" style="padding:8px;border-radius:8px;border:1px solid #cbd5e1">
            <option value="percent" ${it.type!=='fixed'?'selected':''}>%</option>
            <option value="fixed" ${it.type==='fixed'?'selected':''}>Fixed</option>
          </select>
          <input data-f="value" value="${esc(it.value!=null?it.value:0)}" style="padding:8px;border-radius:8px;border:1px solid #cbd5e1">
          <select data-f="apply_to" style="padding:8px;border-radius:8px;border:1px solid #cbd5e1">
            <option value="all" ${!it.apply_to||it.apply_to==='all'?'selected':''}>Semua</option>
            <option value="ppob" ${it.apply_to==='ppob'?'selected':''}>PPOB</option>
            <option value="transfer" ${it.apply_to==='transfer'?'selected':''}>Transfer</option>
          </select>
          <label style="font-size:.8rem"><input type="checkbox" data-f="active" ${it.active!==false?'checked':''}> Aktif</label>
          <button type="button" class="btn btn-outline btn-sm" data-tax-del="${i}">✕</button>
        </div>`).join('');
      box.querySelectorAll('[data-tax-del]').forEach(btn => {
        btn.onclick = () => { box._items.splice(Number(btn.dataset.taxDel), 1); render(); };
      });
      box.querySelectorAll('.tax-row').forEach(row => {
        const i = Number(row.dataset.i);
        row.querySelectorAll('[data-f]').forEach(inp => {
          const sync = () => {
            const f = inp.dataset.f;
            if (f === 'active') box._items[i].active = inp.checked;
            else if (f === 'value') box._items[i].value = Number(inp.value) || 0;
            else box._items[i][f] = inp.value;
          };
          inp.onchange = sync; inp.oninput = sync;
        });
      });
    };
    render();
  } catch (e) {
    box.innerHTML = '<p class="alert alert-error">' + esc(e.message) + '</p>';
  }
}


async function loadApiMonitor() {
  const box = document.getElementById('api-monitor-panel');
  if (!box) return;
  async function render() {
    try {
      const j = await adminJson(API + '/admin/api-monitor', { headers: authHeaders() });
      const d = j.data || {};
      const rows = d.channels || [];
      box.innerHTML = `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
          <button type="button" class="btn btn-primary" id="mon-run">Manual Test</button>
          <span style="font-size:.85rem;color:#64748b">Terakhir: ${esc(d.last_run || '—')} · Auto setiap 30 menit</span>
        </div>
        <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">
          <span class="badge" style="background:#dcfce7">Connected: ${d.summary?.connected||0}</span>
          <span class="badge" style="background:#fee2e2">Disconnected: ${d.summary?.disconnected||0}</span>
          <span class="badge" style="background:#f1f5f9">Disabled: ${d.summary?.disabled||0}</span>
        </div>
        <div style="overflow:auto">
        <table style="width:100%;font-size:.85rem"><thead><tr>
          <th>Channel</th><th>Jenis API</th><th>Tahapan</th><th>Status</th><th>Latency</th><th>Catatan</th>
        </tr></thead><tbody>
        ${rows.map(c => `<tr>
          <td><strong>${esc(c.name)}</strong></td>
          <td>${esc(c.type)}</td>
          <td><span class="badge">${esc(c.stage)}</span></td>
          <td style="color:${c.status==='Connected'?'#16a34a':(c.status==='Disabled'?'#64748b':'#dc2626')}">${esc(c.status)}</td>
          <td>${c.latency_ms||0} ms</td>
          <td style="font-size:.75rem">${esc(c.note||'')}</td>
        </tr>`).join('') || '<tr><td colspan="6">Belum ada data — tekan Manual Test</td></tr>'}
        </tbody></table></div>`;
      document.getElementById('mon-run').onclick = async () => {
        adminToast('Menjalankan monitoring…', 'info');
        try {
          const r = await fetch(API + '/admin/api-monitor/run', { method: 'POST', headers: authHeaders(), body: '{}' });
          const j2 = await r.json();
          adminToast(j2.message || '', j2.success ? 'success' : 'error');
          render();
        } catch (e) {
          adminToast(e.message || 'Gagal', 'error');
        }
      };
    } catch (e) {
      box.innerHTML = '<p class="alert alert-error">Gagal muat monitoring: ' + esc(e.message) + '</p>';
    }
  }
  render();
}

document.addEventListener('click', async (e) => {
  const t = e.target;
  if (!t) return;
  if (t.id === 'btn-add-fee-service' || t.id === 'btn-fee-add-service') {
    const box = document.getElementById('fees-service-items');
    const items = (box && box._items) ? box._items : [];
    items.push({ name: 'Biaya Layanan', type: 'percent', value: 1, active: true });
    renderFeeItems('fees-service-items', items, 'svc');
  }
  if (t.id === 'btn-add-fee-markup' || t.id === 'btn-fee-add-markup') {
    const box = document.getElementById('fees-markup-items');
    const items = (box && box._items) ? box._items : [];
    items.push({ name: 'Markup', type: 'fixed', value: 0, active: true });
    renderFeeItems('fees-markup-items', items, 'mk');
  }
  if (t.id === 'btn-add-fee-transfer' || t.id === 'btn-fee-add-transfer') {
    const box = document.getElementById('fees-transfer-items');
    const items = (box && box._items) ? box._items : [];
    items.push({ name: 'Biaya Admin', type: 'fixed', value: 500, active: true });
    renderFeeItems('fees-transfer-items', items, 'tr');
  }
  if (t.id === 'btn-save-fees') {
    const body = {
      service: { items: collectFeeItems('fees-service-items') },
      markup: { items: collectFeeItems('fees-markup-items') },
      transfer: { items: collectFeeItems('fees-transfer-items') }
    };
    const r = await fetch(API + '/admin/fees', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
    const j = await r.json();
    const msg = document.getElementById('fees-msg');
    if (msg) msg.innerHTML = j.success ? '<div class="alert alert-success">Disimpan</div>' : '<div class="alert alert-error">' + esc(j.message||'Gagal') + '</div>';
    adminToast(j.message || (j.success ? 'Biaya disimpan' : 'Gagal'), j.success ? 'success' : 'error');
  }
  if (t.id === 'btn-add-tax' || t.id === 'btn-tax-add') {
    const box = document.getElementById('taxes-editor');
    if (!box) return;
    if (!box._items) box._items = [];
    box._items.push({ id: 'tax-' + Date.now(), name: 'Pajak', type: 'percent', value: 0, active: true, apply_to: 'all' });
    window.__taxItemsCache = box._items;
    loadTaxes(true);
  }
  if (t.id === 'btn-save-taxes') {
    const box = document.getElementById('taxes-editor');
    const items = (box && box._items) || [];
    const r = await fetch(API + '/admin/taxes', { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ items }) });
    const j = await r.json();
    const msg = document.getElementById('taxes-msg');
    if (msg) msg.innerHTML = j.success ? '<div class="alert alert-success">Pajak disimpan</div>' : '<div class="alert alert-error">' + esc(j.message||'Gagal') + '</div>';
    adminToast(j.message || (j.success ? 'Pajak disimpan' : 'Gagal'), j.success ? 'success' : 'error');
  }
}, true);



/* —— Maintenance / Omnichannel / TOTP / Cleanup / Landing —— */
function adminUiToast(msg, type) {
  try {
    if (typeof adminToast === 'function') adminToast(msg, type || 'info');
    else if (typeof toast === 'function') toast(msg, type || 'info');
    else console.log('[admin]', type, msg);
  } catch (e) { console.log(msg); }
}

async function adminApi(path, opts) {
  opts = opts || {};
  const method = (opts.method || 'GET').toUpperCase();
  const headers = Object.assign({}, authHeaders(), opts.headers || {});
  const fetchOpts = { method: method, headers: headers };
  if (opts.body != null) {
    fetchOpts.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }
  return adminJson(API + path, fetchOpts);
}

async function loadMaintenance() {
  try {
    const r = await adminApi('/admin/maintenance');
    const d = r.data || {};
    const en = document.getElementById('maint-enabled');
    const msg = document.getElementById('maint-message');
    if (en) en.checked = !!d.enabled;
    if (msg) msg.value = d.message || 'Sistem dalam maintenance';
    const st = document.getElementById('maint-status');
    if (st) st.textContent = d.enabled ? 'Status: AKTIF — Pengguna & Merchant diblokir' : 'Status: nonaktif';
  } catch (e) {
    adminUiToast(e.message || 'Gagal memuat maintenance', 'error');
  }
}

async function saveMaintenance() {
  try {
    const body = {
      enabled: !!document.getElementById('maint-enabled')?.checked,
      message: document.getElementById('maint-message')?.value || 'Sistem dalam maintenance'
    };
    const r = await adminApi('/admin/maintenance', { method: 'PUT', body: body });
    adminUiToast(r.message || (body.enabled ? 'Maintenance ON' : 'Maintenance OFF'), r.success !== false ? 'success' : 'error');
    await loadMaintenance();
  } catch (e) {
    adminUiToast(e.message || 'Gagal menyimpan', 'error');
  }
}

async function loadOmnichannel() {
  try {
    const r = await adminApi('/admin/omnichannel');
    const d = r.data || {};
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v || '';
    };
    set('omni-enabled', d.enabled !== false);
    set('omni-url', d.webhook_url);
    set('omni-secret', d.webhook_secret);
    const ch = d.channels || {};
    set('omni-ch-pwa', ch.pwa !== false);
    set('omni-ch-merchant', ch.merchant !== false);
    set('omni-ch-wa', ch.whatsapp);
    set('omni-ch-tg', ch.telegram);
    set('omni-ch-chrome', ch.chrome);
    set('omni-ch-electron', ch.electron);
    set('omni-ch-php', ch.php);
  } catch (e) {
    adminUiToast(e.message || 'Gagal memuat omnichannel', 'error');
  }
}

async function saveOmnichannel() {
  try {
    const body = {
      enabled: !!document.getElementById('omni-enabled')?.checked,
      webhook_url: document.getElementById('omni-url')?.value,
      webhook_secret: document.getElementById('omni-secret')?.value,
      channels: {
        pwa: !!document.getElementById('omni-ch-pwa')?.checked,
        merchant: !!document.getElementById('omni-ch-merchant')?.checked,
        whatsapp: !!document.getElementById('omni-ch-wa')?.checked,
        telegram: !!document.getElementById('omni-ch-tg')?.checked,
        chrome: !!document.getElementById('omni-ch-chrome')?.checked,
        electron: !!document.getElementById('omni-ch-electron')?.checked,
        php: !!document.getElementById('omni-ch-php')?.checked
      }
    };
    const r = await adminApi('/admin/omnichannel', { method: 'PUT', body: body });
    adminUiToast(r.success !== false ? 'Omnichannel disimpan' : (r.message || 'Gagal'), r.success !== false ? 'success' : 'error');
  } catch (e) {
    adminUiToast(e.message || 'Gagal menyimpan', 'error');
  }
}

async function testOmnichannel() {
  try {
    const r = await adminApi('/admin/omnichannel/webhook-test', { method: 'POST', body: {} });
    const out = document.getElementById('omni-test-out');
    if (out) out.textContent = JSON.stringify(r, null, 2);
    adminUiToast(r.message || (r.success ? 'OK' : 'Gagal'), r.success ? 'success' : 'error');
  } catch (e) {
    adminUiToast(e.message || 'Test gagal', 'error');
  }
}

const LANDING_DEFAULTS = {
  hero_title: 'bdPay PWA — Portofolio Digital',
  hero_subtitle: 'PPOB, Transfer Request, Merchant UMKM, Open API. Personal Website Application & Self-service.',
  merchant_banner: 'Daftar Open API merchant, kelola transfer & penagihan pelanggan Anda. Skala Mikro, Kecil, dan Menengah.',
  show_price_compare: true,
  show_feature_cloud: true
};

async function loadLandingPromo() {
  try {
    const r = await adminApi('/admin/landing-promo');
    const d = Object.assign({}, LANDING_DEFAULTS, r.data || {});
    const set = (id, v, chk) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (chk) el.checked = !!v;
      else el.value = v != null ? v : '';
    };
    set('lp-title', d.hero_title || LANDING_DEFAULTS.hero_title);
    set('lp-sub', d.hero_subtitle || LANDING_DEFAULTS.hero_subtitle);
    set('lp-merchant', d.merchant_banner || LANDING_DEFAULTS.merchant_banner);
    set('lp-pc', d.show_price_compare !== false, true);
    set('lp-cloud', d.show_feature_cloud !== false, true);
  } catch (e) {
    // isi default lokal
    document.getElementById('lp-title') && (document.getElementById('lp-title').value = LANDING_DEFAULTS.hero_title);
    document.getElementById('lp-sub') && (document.getElementById('lp-sub').value = LANDING_DEFAULTS.hero_subtitle);
    document.getElementById('lp-merchant') && (document.getElementById('lp-merchant').value = LANDING_DEFAULTS.merchant_banner);
    adminUiToast(e.message || 'Gagal memuat — menampilkan default', 'warn');
  }
}

async function resetLandingPromo() {
  const d = LANDING_DEFAULTS;
  const set = (id, v, chk) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (chk) el.checked = !!v; else el.value = v;
  };
  set('lp-title', d.hero_title);
  set('lp-sub', d.hero_subtitle);
  set('lp-merchant', d.merchant_banner);
  set('lp-pc', true, true);
  set('lp-cloud', true, true);
  adminUiToast('Form diisi ulang dengan default', 'info');
}

async function saveLandingPromo() {
  try {
    const body = {
      hero_title: document.getElementById('lp-title')?.value || LANDING_DEFAULTS.hero_title,
      hero_subtitle: document.getElementById('lp-sub')?.value || LANDING_DEFAULTS.hero_subtitle,
      merchant_banner: document.getElementById('lp-merchant')?.value || LANDING_DEFAULTS.merchant_banner,
      show_price_compare: !!document.getElementById('lp-pc')?.checked,
      show_feature_cloud: !!document.getElementById('lp-cloud')?.checked
    };
    const r = await adminApi('/admin/landing-promo', { method: 'PUT', body: body });
    adminUiToast(r.success !== false ? 'Landing promo disimpan' : 'Gagal', r.success !== false ? 'success' : 'error');
  } catch (e) {
    adminUiToast(e.message || 'Gagal menyimpan', 'error');
  }
}

async function loadTotpStatus() {
  try {
    const r = await adminApi('/admin/totp/status');
    const d = r.data || {};
    const el = document.getElementById('totp-status');
    if (el) {
      el.textContent = d.enabled
        ? 'Google Authenticator: AKTIF'
        : (d.require_pairing ? 'Perlu pairing Authenticator' : 'Belum diaktifkan — klik Generate Secret');
    }
    const hs = document.getElementById('totp-hard-status');
    if (hs) {
      hs.textContent = d.hard_reset_configured
        ? 'Kode Hard Reset: sudah dikonfigurasi (tidak ditampilkan ulang)'
        : 'Kode Hard Reset: belum ada — generate secret untuk membuatnya';
    }
    const btn = document.getElementById('btn-totp-setup');
    if (btn) btn.disabled = false;
  } catch (e) {
    adminUiToast(e.message || 'Gagal status TOTP', 'error');
  }
}

function showTotpSetupData(d) {
  const box = document.getElementById('totp-setup-box');
  if (box) {
    box.classList.remove('hidden');
    box.style.display = '';
  }
  const sec = document.getElementById('totp-secret');
  const url = document.getElementById('totp-url');
  const qr = document.getElementById('totp-qr');
  const hard = document.getElementById('totp-hard-reset');
  if (sec) sec.textContent = d.secret || '';
  if (url) url.textContent = d.otpauth_url || '';
  if (qr) {
    if (d.qr_data_url) {
      qr.src = d.qr_data_url;
      qr.style.display = '';
    } else if (d.otpauth_url) {
      // fallback client-side QR via Google chart API-free: use otpauth text only
      qr.removeAttribute('src');
      qr.alt = 'QR tidak tersedia — masukkan secret manual';
    }
  }
  if (hard) hard.textContent = d.hard_reset_code || '(akan tampil saat generate)';
}

async function setupTotp() {
  try {
    const btn = document.getElementById('btn-totp-setup');
    if (btn) { btn.disabled = true; btn.textContent = 'Memproses…'; }
    const r = await adminApi('/admin/totp/setup', { method: 'POST', body: {} });
    if (btn) { btn.disabled = false; btn.textContent = 'Generate Secret / QR Setup'; }
    if (!r.success) return adminUiToast(r.message || 'Gagal', 'error');
    showTotpSetupData(r.data || {});
    adminUiToast(r.message || 'QR siap di-scan', 'success');
  } catch (e) {
    const btn = document.getElementById('btn-totp-setup');
    if (btn) { btn.disabled = false; btn.textContent = 'Generate Secret / QR Setup'; }
    adminUiToast(e.message || 'Gagal generate secret', 'error');
  }
}

async function confirmTotp() {
  try {
    const code = document.getElementById('totp-code')?.value || '';
    if (!/^\d{6}$/.test(code)) return adminUiToast('Masukkan kode 6 digit', 'warn');
    const r = await adminApi('/admin/totp/confirm', { method: 'POST', body: { totp: code } });
    adminUiToast(r.message || '', r.success ? 'success' : 'error');
    if (r.success) {
      if (r.data && r.data.hard_reset_code) {
        const hard = document.getElementById('totp-hard-reset');
        if (hard) hard.textContent = r.data.hard_reset_code;
        adminUiToast('Simpan Kode Hard Reset sekarang!', 'warn');
      }
      loadTotpStatus();
    }
  } catch (e) {
    adminUiToast(e.message || 'Gagal konfirmasi', 'error');
  }
}

async function hardResetTotp() {
  try {
    const code = (document.getElementById('totp-hard-input')?.value || '').trim();
    if (!code) return adminUiToast('Isi Kode Hard Reset', 'warn');
    if (!confirm('Nonaktifkan Google Authenticator dengan Hard Reset?')) return;
    const r = await adminApi('/admin/totp/hard-reset', { method: 'POST', body: { hard_reset_code: code } });
    adminUiToast(r.message || '', r.success ? 'success' : 'error');
    if (r.success) {
      document.getElementById('totp-hard-input').value = '';
      loadTotpStatus();
    }
  } catch (e) {
    adminUiToast(e.message || 'Hard reset gagal', 'error');
  }
}

async function regenerateHardReset() {
  try {
    const totp = document.getElementById('totp-regen-code')?.value || '';
    if (!/^\d{6}$/.test(totp)) return adminUiToast('Isi kode Authenticator 6 digit', 'warn');
    const r = await adminApi('/admin/totp/regenerate-hard-reset', { method: 'POST', body: { totp } });
    adminUiToast(r.message || '', r.success ? 'success' : 'error');
    if (r.success && r.data?.hard_reset_code) {
      const el = document.getElementById('totp-hard-new');
      if (el) {
        el.style.display = 'block';
        el.textContent = r.data.hard_reset_code;
      }
      const hard = document.getElementById('totp-hard-reset');
      if (hard) hard.textContent = r.data.hard_reset_code;
    }
  } catch (e) {
    adminUiToast(e.message || 'Gagal', 'error');
  }
}


async function runCleanupDemo() {
  try {
    if (!confirm('Hapus demo & ganti admin? Tindakan ini tidak bisa dibatalkan.')) return;
    const body = {
      username: document.getElementById('clean-user')?.value,
      password: document.getElementById('clean-pass')?.value
    };
    const r = await adminApi('/admin/cleanup-demo', { method: 'POST', body: body });
    const out = document.getElementById('clean-out');
    if (out) out.textContent = JSON.stringify(r, null, 2);
    adminUiToast(r.message || '', r.success ? 'success' : 'error');
    if (r.success && r.data?.totp_secret) {
      const box = document.getElementById('totp-setup-box');
      if (box) { box.classList.remove('hidden'); box.style.display = ''; }
      const sec = document.getElementById('totp-secret');
      const url = document.getElementById('totp-url');
      if (sec) sec.textContent = r.data.totp_secret;
      if (url) url.textContent = r.data.otpauth_url || '';
      showSection('totp-admin');
      loadTotpStatus();
    }
  } catch (e) {
    adminUiToast(e.message || 'Cleanup gagal', 'error');
  }
}

// Event binding (langsung + delegasi agar selalu bisa diklik)
function bindAdminExtraOnce() {
  const map = [
    ['btn-save-maint', saveMaintenance],
    ['btn-save-omni', saveOmnichannel],
    ['btn-test-omni', testOmnichannel],
    ['btn-save-lp', saveLandingPromo],
    ['btn-reset-lp', resetLandingPromo],
    ['btn-totp-setup', setupTotp],
    ['btn-totp-confirm', confirmTotp],
    ['btn-totp-hard-reset', hardResetTotp],
    ['btn-totp-regen-hard', regenerateHardReset],
    ['btn-cleanup-demo', runCleanupDemo]
  ];
  map.forEach(([id, fn]) => {
    const el = document.getElementById(id);
    if (el && el.dataset.boundExtra !== '1') {
      el.dataset.boundExtra = '1';
      el.addEventListener('click', (e) => { e.preventDefault(); fn(); });
    }
  });
}
bindAdminExtraOnce();
document.addEventListener('click', (e) => {
  const t = e.target && e.target.closest ? e.target.closest('[id]') : null;
  if (!t || !t.id) return;
  if (t.id === 'btn-save-maint') { e.preventDefault(); saveMaintenance(); }
  else if (t.id === 'btn-totp-setup') { e.preventDefault(); setupTotp(); }
  else if (t.id === 'btn-totp-confirm') { e.preventDefault(); confirmTotp(); }
  else if (t.id === 'btn-save-lp') { e.preventDefault(); saveLandingPromo(); }
  else if (t.id === 'btn-reset-lp') { e.preventDefault(); resetLandingPromo(); }
  else if (t.id === 'btn-save-omni') { e.preventDefault(); saveOmnichannel(); }
  else if (t.id === 'btn-test-omni') { e.preventDefault(); testOmnichannel(); }
  else if (t.id === 'btn-cleanup-demo') { e.preventDefault(); runCleanupDemo(); }
});



/* —— Request Logs —— */
async function loadRequestLogSettings() {
  try {
    const r = await adminJson(API + '/admin/request-log-settings', { headers: authHeaders() });
    const d = r.data || {};
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
    set('rlog-enabled', d.enabled !== false);
    set('rlog-console', d.console !== false);
    set('rlog-persist', d.persist !== false);
  } catch (e) { console.warn(e); }
}
async function loadRequestLogs() {
  try {
    await loadRequestLogSettings();
    const lim = document.getElementById('rlog-limit')?.value || 100;
    const r = await adminJson(API + '/admin/request-logs?limit=' + lim, { headers: authHeaders() });
    const tb = document.querySelector('#rlog-table tbody');
    if (!tb) return;
    const rows = r.data || [];
    tb.innerHTML = rows.map(x => '<tr>' +
      '<td>' + escHtml((x.at || '').replace('T', ' ').slice(0, 19)) + '</td>' +
      '<td>' + escHtml(x.method) + '</td>' +
      '<td style="max-width:280px;word-break:break-all">' + escHtml(x.path) + '</td>' +
      '<td>' + escHtml(x.status) + '</td>' +
      '<td>' + escHtml(x.duration_ms) + '</td>' +
      '<td>' + escHtml(x.ip) + '</td>' +
      '<td style="font-size:.75rem">' + escHtml((x.id || '').slice(0, 8)) + '</td>' +
      '</tr>').join('') || '<tr><td colspan="7">Belum ada log</td></tr>';
  } catch (e) {
    if (typeof adminToast === 'function') adminToast(e.message || 'Gagal muat log', 'error');
  }
}
document.getElementById('btn-rlog-reload')?.addEventListener('click', () => loadRequestLogs());
document.getElementById('btn-rlog-save')?.addEventListener('click', async () => {
  try {
    const body = {
      enabled: !!document.getElementById('rlog-enabled')?.checked,
      console: !!document.getElementById('rlog-console')?.checked,
      persist: !!document.getElementById('rlog-persist')?.checked
    };
    const r = await adminJson(API + '/admin/request-log-settings', {
      method: 'PUT', headers: authHeaders(), body: JSON.stringify(body)
    });
    if (typeof adminToast === 'function') adminToast(r.message || 'Disimpan', r.success !== false ? 'success' : 'error');
  } catch (e) {
    if (typeof adminToast === 'function') adminToast(e.message || 'Gagal', 'error');
  }
});
document.getElementById('btn-rlog-clear')?.addEventListener('click', async () => {
  if (!confirm('Kosongkan semua request log?')) return;
  try {
    await adminJson(API + '/admin/request-logs', { method: 'DELETE', headers: authHeaders() });
    loadRequestLogs();
    if (typeof adminToast === 'function') adminToast('Log dikosongkan', 'success');
  } catch (e) {
    if (typeof adminToast === 'function') adminToast(e.message || 'Gagal', 'error');
  }
});
// nav
(function(){
  const orig = document.querySelectorAll('.sidebar a[data-section]');
  orig.forEach(a => {
    a.addEventListener('click', () => {
      if (a.getAttribute('data-section') === 'request-logs') setTimeout(loadRequestLogs, 50);
    });
  });
})();
