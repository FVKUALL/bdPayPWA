
async function loadGoogleConfig() {
  try {
    const r = await fetch('/api/public/config');
    const j = await r.json();
    window.__google = (j.data && j.data.google) || {};
  } catch (_) { window.__google = {}; }
}
function initMerchantGoogle() {
  const g = window.__google || {};
  const btn = document.getElementById('btn-google-sim');
  if (!btn) return;
  if (g.enabled !== false && g.client_id) {
    btn.textContent = 'Lanjut dengan Google';
    btn.onclick = null;
    const mount = document.createElement('div');
    mount.id = 'm-google-btn';
    mount.style.marginTop = '8px';
    btn.replaceWith(mount);
    const boot = () => {
      window.google.accounts.id.initialize({
        client_id: g.client_id,
        callback: async (response) => {
          try {
            const r = await fetch(API + '/google-login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ credential: response.credential })
            });
            const j = await r.json();
            if (!j.success) { toast(j.message || 'Google login gagal', 'error'); return; }
            saveSession(j.data.merchant, j.data.token);
            startMerchantIdle && startMerchantIdle();
            location.reload();
          } catch (e) { toast('Gagal Google login', 'error'); }
        }
      });
      window.google.accounts.id.renderButton(mount, { theme: 'outline', size: 'large', width: mount.offsetWidth || 320, text: 'continue_with', locale: 'id' });
    };
    if (!window.google?.accounts) {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = boot;
      document.head.appendChild(s);
    } else boot();
  } else {
    btn.title = 'Setel Google Client ID di Admin → API & Settings agar OAuth live aktif';
  }
}

async function ensureMerchantPin() {
  const tok = localStorage.getItem('bdpay_merchant_token') || sessionStorage.getItem('merchant_token');
  if (!tok) return false;
  try {
    const c = JSON.parse(sessionStorage.getItem('m_pin_ok') || 'null');
    if (c && c.t && (Date.now() - c.t) < 5 * 60 * 1000) return true;
  } catch (_) {}
  const headers = { 'Content-Type': 'application/json', 'X-Merchant-Auth': tok };
  let pinSet = false;
  let isDemo = false;
  try {
    const r = await fetch('/api/merchant/me', { headers: { 'X-Merchant-Auth': tok } });
    const j = await r.json();
    pinSet = !!(j.data && j.data.pin_set);
    isDemo = !!(j.data && (j.data.email === 'merchant@demo.bdpay' || j.data.id === 'mch-demo-001'));
  } catch (_) {}
  const demoHint = isDemo ? ' · Demo: 123456' : '';
  async function askPin(title, desc) {
    if (window.BdSecurity && typeof BdSecurity.requestPin === 'function') {
      return await BdSecurity.requestPin({ title: title, desc: desc + demoHint });
    }
    return (await inappPrompt(title + (demoHint || ''), '', { okText: 'OK' })) || null;
  }
  if (!pinSet) {
    const pin = await askPin('Atur PIN Merchant', 'Buat PIN 6 digit untuk transaksi');
    if (!pin || !/^\d{6}$/.test(pin)) { toast('PIN wajib 6 digit', 'warn'); return false; }
    const r = await fetch('/api/merchant/pin/set', { method: 'POST', headers, body: JSON.stringify({ pin }) });
    const j = await r.json();
    if (!j.success) { toast(j.message || 'Gagal set PIN', 'error'); return false; }
    sessionStorage.setItem('m_pin_ok', JSON.stringify({ t: Date.now() }));
    toast('PIN berhasil diatur', 'success');
    return true;
  }
  const pin = await askPin('PIN Transaksi', 'Masukkan PIN 6 digit');
  if (!pin) { toast('Masukkan PIN untuk melanjutkan', 'warn'); return false; }
  if (!/^\d{6}$/.test(pin)) { toast('PIN harus 6 digit', 'warn'); return false; }
  const r = await fetch('/api/merchant/pin/verify', { method: 'POST', headers, body: JSON.stringify({ pin }) });
  const j = await r.json();
  if (!j.success) { toast(j.message || 'PIN salah', 'error'); return false; }
  sessionStorage.setItem('m_pin_ok', JSON.stringify({ t: Date.now() }));
  return true;
}

  function startMerchantIdle() {
    if (!window.BdSecurity) return;
    BdSecurity.startIdleWatch({
      onLogout: () => {
        try {
          sessionStorage.removeItem('merchant_token');
          sessionStorage.removeItem('merchant_data');
          sessionStorage.removeItem('m_pin_ok');
          localStorage.removeItem('bdpay_merchant_token');
          localStorage.removeItem('bdpay_merchant');
        } catch (_) {}
        merchant = null;
        try { document.getElementById('idle-session-box')?.remove(); document.body.classList.remove('session-blur'); } catch (_) {}
        location.href = '/merchant/?session=expired';
      }
    });
  }
/**
 * bdPay Merchant Portal — UMKM Self-Service
 */
(function () {
  'use strict';
  const API = '/api/merchant';
  let merchant = null;

  function toast(msg, type, ms) {
    type = type || 'info'; ms = ms || 3500;
    const box = document.getElementById('m-toast');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'm-toast-item ' + type;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }
  function inappConfirm(message, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'm-inapp-overlay';
      ov.innerHTML = '<div class="m-inapp-card">' +
        '<p class="m-inapp-msg">' + String(message || '').replace(/</g,'&lt;') + '</p>' +
        '<div class="m-inapp-actions">' +
        '<button type="button" class="btn btn-outline" data-a="no">' + (opts.cancelText || 'Batal') + '</button>' +
        '<button type="button" class="btn btn-primary" data-a="yes">' + (opts.okText || 'Ya') + '</button>' +
        '</div></div>';
      document.body.appendChild(ov);
      ov.querySelector('[data-a="yes"]').onclick = () => { ov.remove(); resolve(true); };
      ov.querySelector('[data-a="no"]').onclick = () => { ov.remove(); resolve(false); };
    });
  }
  function inappPrompt(message, defaultVal, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'm-inapp-overlay';
      ov.innerHTML = '<div class="m-inapp-card">' +
        '<p class="m-inapp-msg">' + String(message || '').replace(/</g,'&lt;') + '</p>' +
        '<input class="m-inapp-input" id="m-inapp-inp" value="' + String(defaultVal || '').replace(/"/g,'&quot;') + '">' +
        '<div class="m-inapp-actions">' +
        '<button type="button" class="btn btn-outline" data-a="no">' + (opts.cancelText || 'Batal') + '</button>' +
        '<button type="button" class="btn btn-primary" data-a="yes">' + (opts.okText || 'OK') + '</button>' +
        '</div></div>';
      document.body.appendChild(ov);
      const inp = ov.querySelector('#m-inapp-inp');
      setTimeout(() => inp && inp.focus(), 50);
      ov.querySelector('[data-a="yes"]').onclick = () => { const v = inp.value; ov.remove(); resolve(v); };
      ov.querySelector('[data-a="no"]').onclick = () => { ov.remove(); resolve(null); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ov.querySelector('[data-a="yes"]').click(); });
    });
  }

  function authHeaders() {
    const t = sessionStorage.getItem('merchant_token') || '';
    return { 'Content-Type': 'application/json', 'X-Merchant-Auth': t };
  }
  function saveSession(m, token) {
    merchant = m;
    sessionStorage.setItem('merchant_token', token);
    sessionStorage.setItem('merchant_data', JSON.stringify(m));
    try { startMerchantIdle(); } catch (_) {}
  }
  function loadSession() {
    try {
      merchant = JSON.parse(sessionStorage.getItem('merchant_data') || 'null');
      return merchant;
    } catch { return null; }
  }
  function fmtRp(n) {
    return 'Rp ' + (Number(n) || 0).toLocaleString('id-ID');
  }
  function formatCurrencyInput(el) {
    if (!el) return;
    const raw = String(el.value).replace(/\D/g, '');
    if (!raw) { el.value = ''; return; }
    el.value = Number(raw).toLocaleString('id-ID');
    try { el.setSelectionRange(el.value.length, el.value.length); } catch (_) {}
  }
  function serviceBadge(key) {
    try {
      if (window.BdServiceStage && BdServiceStage.badgeHtml) return BdServiceStage.badgeHtml(key, key);
    } catch (_) {}
    return '';
  }
  function parseCurrency(v) {
    return Number(String(v || '').replace(/\D/g, '')) || 0;
  }
  function wireCurrency(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('inputmode', 'numeric');
    el.addEventListener('input', () => formatCurrencyInput(el));
  }
  function requireFields(pairs) {
    for (const [id, label] of pairs) {
      const el = document.getElementById(id);
      const v = el ? String(el.value || '').trim() : '';
      if (!v) { toast(label + ' wajib diisi', 'warn'); el && el.focus(); return false; }
    }
    return true;
  }

  // Tabs
  document.querySelectorAll('.m-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.m-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const id = tab.dataset.tab;
      document.getElementById('form-login').classList.toggle('hidden', id !== 'login');
      if (id === 'login' && window.BdSecurity) BdSecurity.loadCaptcha('captcha-box-m-login');
      if (id === 'register' && window.BdSecurity) BdSecurity.loadCaptcha('captcha-box-m-register');
      if (id === 'forgot' && window.BdSecurity) BdSecurity.loadCaptcha('captcha-box-m-forgot');
      document.getElementById('form-register').classList.toggle('hidden', id !== 'register');
      document.getElementById('form-forgot').classList.toggle('hidden', id !== 'forgot');
    });
  });
  document.querySelectorAll('.m-eye').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = document.getElementById(btn.dataset.for);
      if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
    });
  });

  // Demo
  
  document.getElementById('btn-google-sim')?.addEventListener('click', async () => {
    const email = await inappPrompt('Email Google (simulasi):', 'umkm.google@gmail.com');
    if (!email) return;
    const name = (await inappPrompt('Nama tampilan Google:', 'PIC Google UMKM')) || 'PIC Google';
    try {
      const r = await fetch(API + '/google-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...capR, email, name, google_id: 'sim-g-' + Date.now() })
      });
      const j = await r.json();
      if (!j.success) { toast(j.message || 'Gagal', 'error'); return; }
      saveSession(j.data.merchant, j.data.token);
      showApp();
      showSection('register-flow');
      toast('Google Login OK (simulasi). Lanjut verifikasi.', 'success');
    } catch (e) { toast('Gagal terhubung', 'error'); }
  });


  document.getElementById('btn-demo-merchant')?.addEventListener('click', async () => {
    document.getElementById('login-email').value = 'merchant@demo.bdpay';
    document.getElementById('login-pass').value = 'demo123';
    try {
      const r = await fetch(API + '/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'merchant@demo.bdpay', password: 'demo123', demo: true })
      });
      const j = await r.json();
      if (!j.success) { toast(j.message || 'Login demo gagal', 'error'); return; }
      saveSession(j.data.merchant, j.data.token);
      showApp();
      toast('Demo login · PIN default: 123456', 'success');
    } catch (e) { toast('Gagal terhubung', 'error'); }
  });

  // Login
  document.getElementById('form-login')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-pass').value;
    try {
      const cap = window.BdSecurity ? BdSecurity.getCaptchaPayload(document.getElementById('form-login')) : {};
      const r = await fetch(API + '/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, ...cap })
      });
      const j = await r.json();
      if (!j.success) { toast(j.message || 'Login gagal', 'error'); return; }
      saveSession(j.data.merchant, j.data.token);
      showApp();
      toast('Selamat datang, ' + (j.data.merchant.trade_name || j.data.merchant.pic_name), 'success');
    } catch (err) { toast('Gagal terhubung', 'error'); }
  });

  // Register
  document.getElementById('form-register')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pic_name = document.getElementById('reg-pic').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const trade_name = document.getElementById('reg-trade').value.trim();
    const password = document.getElementById('reg-pass').value;
    const password2 = document.getElementById('reg-pass2').value;
    if (password !== password2) { toast('Password tidak sama', 'warn'); return; }
    try {
      const capR = window.BdSecurity ? BdSecurity.getCaptchaPayload(document.getElementById('form-register')) : {};
      const r = await fetch(API + '/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(window.BdSecurity?BdSecurity.getCaptchaPayload(document.getElementById("form-register")):{}),  pic_name, email, trade_name, password })
      });
      const j = await r.json();
      if (!j.success) { toast(j.message || 'Registrasi gagal', 'error'); return; }
      saveSession(j.data.merchant, j.data.token);
      showApp();
      showSection('register-flow');
      toast('Registrasi berhasil. Lanjutkan verifikasi.', 'success');
    } catch (err) { toast('Gagal terhubung', 'error'); }
  });

  // Forgot
  document.getElementById('form-forgot')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value.trim();
    try {
      const capF = window.BdSecurity ? BdSecurity.getCaptchaPayload(document.getElementById('form-forgot')) : {};
      const r = await fetch(API + '/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...capF,  email })
      });
      const j = await r.json();
      document.getElementById('forgot-msg').textContent = j.message || (j.success ? 'Cek email (simulasi).' : 'Gagal');
      toast(j.message || 'OK', j.success ? 'success' : 'error');
    } catch { toast('Gagal', 'error'); }
  });

  
  async function applyMerchantMenuVisibility() {
    try {
      const r = await fetch('/api/public/merchant-menu');
      const j = await r.json();
      const vis = j.data || {};
      document.querySelectorAll('#m-sidebar a[data-msec]').forEach(a => {
        const id = a.getAttribute('data-msec');
        if (!id) return;
        if (vis[id] === false) a.style.display = 'none';
        else a.style.display = '';
      });
    } catch (_) {}
  }

  function showApp() {
    document.getElementById('view-auth').classList.add('hidden');
    document.getElementById('view-app').classList.remove('hidden');
    applyMerchantMenuVisibility();
    const m = merchant || loadSession();
    if (!m) return;
    const st = m.status || 'pending';
    const badge = document.getElementById('m-header-status');
    if (badge) {
      badge.textContent = st === 'verified' ? 'Verified' : (st === 'on_hold' ? 'On-Hold' : 'Pending');
      badge.className = 'm-badge ' + (st === 'verified' ? 'verified' : (st === 'on_hold' ? 'onhold' : ''));
    }
    try { startMerchantIdle(); } catch (_) {}
    loadDashboard();
  }

  function showSection(id) {
    document.querySelectorAll('.m-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('#m-sidebar a').forEach(a => a.classList.remove('active'));
    const sec = document.getElementById('msec-' + id);
    if (sec) sec.classList.add('active');
    document.querySelector('#m-sidebar a[data-msec="' + id + '"]')?.classList.add('active');
    document.getElementById('m-header-title').textContent =
      ({ dashboard: 'Dashboard', profile: 'Profil UMKM', 'register-flow': 'Kartu Registrasi', transfer: 'Transfer Request',
         vendor: 'Pembayaran Vendor', invoice: 'Invoice Payment', remittance: 'Global Remittance', schedule: 'Jadwal Transfer', saldo: 'Aktivasi Saldo', disbursement: 'Disbursement', payment: 'Pembayaran QRIS/VA', ppob: 'PPOB', reports: 'Laporan', audit: 'Audit Keamanan', inbox: 'Kotak Pesan' })[id] || id;
    try {
    if (id === 'dashboard') loadDashboard();
    if (id === 'profile') loadProfile();
    if (id === 'register-flow') loadRegFlow();
    if (id === 'transfer') loadTransfer();
    if (id === 'vendor') loadVendor();
    if (id === 'invoice') loadInvoice();
    if (id === 'remittance') loadRemittance();
    setTimeout(function(){ try{ if(window.BdServiceStage){ BdServiceStage.clear && BdServiceStage.clear(); BdServiceStage.apply(); } }catch(_){} }, 100);
        if (id === 'saldo') loadSaldo();
    if (id === 'disbursement') loadDisbursement();
        if (id === 'ppob') loadPpob();
    if (id === 'reports') loadReports();
    if (id === 'audit') loadAudit();
    if (id === 'inbox') loadInbox();
    } catch (err) { console.error(err); toast('Error halaman: ' + err.message, 'error'); }
  }

  document.getElementById('m-bell')?.addEventListener('click', () => showSection('inbox'));
  document.getElementById('m-menu-btn')?.addEventListener('click', () => {
    document.getElementById('m-sidebar').classList.toggle('open');
  });
  document.querySelectorAll('#m-sidebar a[data-msec]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      showSection(a.dataset.msec);
      document.getElementById('m-sidebar').classList.remove('open');
    });
  });
  document.getElementById('m-logout')?.addEventListener('click', (e) => {
    e.preventDefault();
    sessionStorage.removeItem('merchant_token');
    sessionStorage.removeItem('merchant_data');
    merchant = null;
    location.reload();
  });

  async function refreshMe() {
    try {
      const r = await fetch(API + '/me', { headers: authHeaders() });
      const text = await r.text();
      let j = {};
      try { j = JSON.parse(text); } catch (_) {
        console.error('me non-json', text.slice(0, 120));
        return merchant || loadSession() || {};
      }
      if (j.success && j.data) {
        merchant = j.data;
        sessionStorage.setItem('merchant_data', JSON.stringify(merchant));
        const st = merchant.status || 'pending';
        const badge = document.getElementById('m-header-status');
        if (badge) {
          badge.textContent = st === 'verified' ? 'Verified' : (st === 'on_hold' ? 'On-Hold' : 'Pending');
          badge.className = 'm-badge ' + (st === 'verified' ? 'verified' : (st === 'on_hold' ? 'onhold' : ''));
        }
      }
    } catch (e) { console.error('refreshMe', e); }
    return merchant || loadSession() || {};
  }

  async function loadDashboard() {
    await refreshMe();
    const m = merchant;
    document.getElementById('m-saldo').textContent = fmtRp(m.balance || 0);
    document.getElementById('m-scale').textContent = (m.scale || '—').toUpperCase();
    try {
      const r = await fetch(API + '/transactions', { headers: authHeaders() });
      const j = await r.json();
      const list = (j.data || []).slice(0, 10);
      document.getElementById('m-tx-count').textContent = (j.data || []).length;
      document.getElementById('m-dash-table').innerHTML =
        '<table style="width:100%;border-collapse:collapse;font-size:.85rem"><thead><tr>' +
        '<th>Tanggal</th><th>Jenis</th><th>Nominal</th><th>Status</th></tr></thead><tbody>' +
        (list.map(t => '<tr><td>' + (t.created_at || '').slice(0, 19).replace('T', ' ') + '</td><td>' +
          (t.type || '-') + '</td><td>' + fmtRp(t.amount) + '</td><td>' + (t.status || '-') +
          '</td></tr>').join('') || '<tr><td colspan="4">Belum ada transaksi</td></tr>') +
        '</tbody></table>';
    } catch { /* ignore */ }
  }

  async function loadProfile() {
    const m = await refreshMe();
    const box = document.getElementById('m-profile-form');
    if (!box) return;
    if (!m || !m.email) {
      box.innerHTML = '<p style="color:#b91c1c">Gagal memuat profil. Login ulang.</p>';
      return;
    }
    box.innerHTML = `
      <div class="form-group"><label>Nama PIC</label><input id="pf-pic" value="${esc(m.pic_name)}" readonly disabled style="opacity:.85;background:#f1f5f9"></div>
      <div class="form-group"><label>Email</label><input id="pf-email" value="${esc(m.email)}" readonly></div>
      <div class="form-group"><label>Nama Dagang</label><input id="pf-trade" value="${esc(m.trade_name)}" readonly disabled style="opacity:.85;background:#f1f5f9"></div>
      <div class="form-group"><label>Logo Dagang</label>
        <input type="file" id="pf-logo-file" accept="image/*">
        <input id="pf-logo" value="${esc(m.logo || '')}" placeholder="URL atau hasil upload" style="margin-top:6px">
        ${(m.logo && String(m.logo).indexOf('data:')===0) ? '<img src="'+m.logo+'" alt="logo" style="max-height:64px;margin-top:8px;border-radius:8px">' : ''}
      </div>
      <div class="form-group"><label>Website</label><input id="pf-web" value="${esc(m.website || '')}" readonly disabled style="opacity:.85;background:#f1f5f9"></div>
      <div class="form-group"><label>Skala</label><input value="${esc((m.scale||'').toUpperCase())}" readonly></div>
      <div class="form-group"><label>Status</label><input value="${esc(m.status||'')}" readonly></div>
      <div class="form-group"><label>Password baru</label><input type="password" id="pf-pass" placeholder="Kosongkan jika tidak ganti"></div>

      <div class="card-panel" style="margin:16px 0;padding:16px;border-radius:14px;border:1px solid #c7d2fe;background:linear-gradient(160deg,#eef2ff,#f8fafc)">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#06b6d4,#6366f1);display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.1rem">🔐</div>
          <div>
            <strong style="display:block">PIN Transaksi (6 digit)</strong>
            <span style="font-size:.8rem;color:#64748b">Status: <b id="m-pin-status" style="color:${m.pin_set ? '#16a34a' : '#d97706'}">${m.pin_set ? 'Sudah diatur' : 'Belum diatur'}</b></span>
          </div>
        </div>
        <p style="font-size:.8rem;color:#64748b;margin:0 0 12px">Wajib saat Transfer Request, Vendor, PPOB, Saldo &amp; Disbursement. Demo: <code>123456</code></p>
        <div class="m-form-grid">
          <div class="form-group"><label>PIN lama</label><input type="password" id="m-pin-old" maxlength="6" inputmode="numeric" placeholder="••••••" autocomplete="off" style="letter-spacing:4px"></div>
          <div class="form-group"><label>PIN baru</label><input type="password" id="m-pin-new" maxlength="6" inputmode="numeric" placeholder="••••••" autocomplete="off" style="letter-spacing:4px"></div>
          <div class="form-group"><label>Ulangi PIN baru</label><input type="password" id="m-pin-new2" maxlength="6" inputmode="numeric" placeholder="••••••" autocomplete="off" style="letter-spacing:4px"></div>
        </div>
        <button type="button" class="btn btn-primary" id="btn-m-save-pin">Simpan PIN</button>
        <p id="m-pin-msg" style="font-size:.85rem;margin-top:8px"></p>
      </div>
      <button type="button" class="btn btn-primary" id="pf-save">Simpan Profil</button>
      <button type="button" class="btn btn-outline" id="pf-edit-reg" style="margin-left:8px">Edit Ulang Registrasi Wizard</button>
    `;
    
    document.getElementById('pf-logo-file')?.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      if (f.size > 500000) { toast('Logo max 500KB', 'warn'); return; }
      const reader = new FileReader();
      reader.onload = () => { document.getElementById('pf-logo').value = reader.result; toast('Logo siap disimpan', 'success'); };
      reader.readAsDataURL(f);
    });

    document.getElementById('pf-edit-reg')?.addEventListener('click', async () => {
      if (!(await inappConfirm('Ulangi seluruh proses registrasi hingga approval otomatis?'))) return;
      const r = await fetch(API + '/wizard/reset', { method: 'POST', headers: authHeaders(), body: '{}' });
      const j = await r.json();
      toast(j.message || '', j.success ? 'success' : 'error');
      if (j.success) {
        if (j.data) { merchant = j.data; sessionStorage.setItem('merchant_data', JSON.stringify(merchant)); }
        showSection('register-flow');
      }
    });
    
    document.getElementById('btn-m-save-pin')?.addEventListener('click', async () => {
      const oldPin = document.getElementById('m-pin-old')?.value || '';
      const pin = document.getElementById('m-pin-new')?.value || '';
      const pin2 = document.getElementById('m-pin-new2')?.value || '';
      const msg = document.getElementById('m-pin-msg');
      if (!/^\d{6}$/.test(pin)) { if (msg) msg.innerHTML = '<span style="color:#e11d48">PIN harus 6 digit</span>'; return; }
      if (pin !== pin2) { if (msg) msg.innerHTML = '<span style="color:#e11d48">PIN tidak sama</span>'; return; }
      const r = await fetch(API + '/pin/set', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ pin, old_pin: oldPin || undefined })
      });
      const j = await r.json();
      if (j.success) {
        if (msg) msg.innerHTML = '<span style="color:#16a34a">PIN tersimpan</span>';
        const st = document.getElementById('m-pin-status');
        if (st) st.textContent = 'Sudah diatur';
        toast('PIN merchant disimpan', 'success');
        refreshMe();
      } else {
        if (msg) msg.innerHTML = '<span style="color:#e11d48">' + (j.message || 'Gagal') + '</span>';
        toast(j.message || 'Gagal', 'error');
      }
    });

    document.getElementById('pf-save').onclick = async () => {
      const body = {
        logo: document.getElementById('pf-logo').value,
        password: document.getElementById('pf-pass').value || undefined
      };
      const r = await fetch(API + '/profile', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
      const j = await r.json();
      toast(j.message || (j.success ? 'Tersimpan' : 'Gagal'), j.success ? 'success' : 'error');
      if (j.success) refreshMe();
    };
  }

  function bankOptionsHtml(selected) {
    const pref = ['bni','permata'];
    const all = [
      {c:'bni',n:'BNI'},{c:'permata',n:'Permata'},{c:'bca',n:'BCA'},{c:'bri',n:'BRI'},
      {c:'mandiri',n:'Mandiri'},{c:'cimb',n:'CIMB Niaga'}
    ];
    let h = '<optgroup label="⭐ Preferred">';
    pref.forEach(c => {
      const b = all.find(x => x.c === c);
      if (b) h += '<option value="'+b.c+'"'+(selected===b.c?' selected':'')+'>★ '+b.n+' — Preferred</option>';
    });
    h += '</optgroup><optgroup label="Bank lainnya">';
    all.filter(b => !pref.includes(b.c)).forEach(b => {
      h += '<option value="'+b.c+'"'+(selected===b.c?' selected':'')+'>'+b.n+'</option>';
    });
    h += '</optgroup>';
    return h;
  }
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function compressDataUrl(dataUrl, maxW, quality) {
    maxW = maxW || 320; quality = quality == null ? 0.55 : quality;
    return new Promise((resolve) => {
      if (!dataUrl || typeof dataUrl !== 'string') return resolve(null);
      const im = new Image();
      im.onload = () => {
        try {
          let w = im.width, h = im.height;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(im, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', quality));
        } catch (_) { resolve(dataUrl); }
      };
      im.onerror = () => resolve(dataUrl);
      im.src = dataUrl;
    });
  }
  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('File kosong'));
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error('FileReader error'));
      fr.readAsDataURL(file);
    });
  }
  // Cache dokumen menengah antar re-render
  const docFileCache = {};


  
  
  const WIZ_PAGES = ['pic', 'umkm', 'kuesioner', 'agreements', 'done'];
  let wizSnapshot = null;
  let wizForcePage = null;
  function snapshotWizard() {
    try { wizSnapshot = JSON.parse(JSON.stringify(merchant || loadSession() || {})); } catch (_) { wizSnapshot = null; }
  }
  function canShowCancel(m) {
    return !!(m && (m.status === 'verified' || (m.wizard && m.wizard.completed_at) || m.registration_completed));
  }
  function cancelBtnHtml(m, id) {
    if (!canShowCancel(m)) return '';
    return '<button type="button" class="btn btn-outline" id="' + id + '">Batal</button>';
  }
  function backBtnHtml(page, id) {
    const idx = WIZ_PAGES.indexOf(page);
    if (idx <= 0) return '';
    return '<button type="button" class="btn btn-outline" id="' + id + '">← Kembali</button>';
  }
  function goWizPage(page) {
    wizForcePage = page;
    loadRegFlow();
  }
  async function cancelWizardEdits() {
    const cur = merchant || loadSession() || {};
    if (!canShowCancel(cur) && !canShowCancel(wizSnapshot || {})) {
      toast('Batal tidak tersedia untuk registrasi pertama', 'info');
      return;
    }
    if (wizSnapshot) {
      merchant = wizSnapshot;
      sessionStorage.setItem('merchant_data', JSON.stringify(merchant));
    }
    const m2 = merchant || {};
    if (m2.status === 'verified' || (m2.wizard && m2.wizard.completed_at)) {
      wizForcePage = 'done';
    } else {
      wizForcePage = null;
    }
    toast('Perubahan dibatalkan', 'info');
    loadRegFlow();
  }

  async function loadRegFlow() {
    const m = await refreshMe();
    if (!m || !m.id) {
      const b = document.getElementById('m-reg-steps');
      if (b) b.innerHTML = '<p style="color:#b91c1c">Session tidak valid. Login ulang.</p>';
      return;
    }
    const stage = (m.wizard && m.wizard.stage) || (m.status === 'verified' ? 'done' : (m.wizard?.pic_done ? (m.wizard?.umkm_done ? (m.registration_steps?.kuesioner_ok ? 'agreements' : 'kuesioner') : 'umkm') : 'pic'));
    let page = wizForcePage || ((m.status === 'verified' && !wizForcePage) ? 'done' : stage);
    if (m.status === 'verified' && !wizForcePage) page = 'done';
    // allow force page even if verified (editing via back)
    if (wizForcePage) page = wizForcePage;
    renderWizProgress(page, m);
    const box = document.getElementById('m-reg-steps');
    if (page === 'pic') renderWizPic(box, m);
    else if (page === 'umkm') renderWizUmkm(box, m);
    else if (page === 'kuesioner') renderWizKuesioner(box, m);
    else if (page === 'agreements') renderWizAgreements(box, m);
    else renderWizDone(box, m);
  }

  function renderWizProgress(page, m) {
    const el = document.getElementById('wiz-progress');
    if (!el) return;
    const labels = { pic: '1. PIC', umkm: '2. UMKM', kuesioner: '3. Kuesioner', agreements: '4. Persetujuan', done: '5. Selesai' };
    const order = WIZ_PAGES;
    const idx = order.indexOf(page);
    el.innerHTML = order.map((k, i) => {
      const cls = i < idx ? 'done' : (i === idx ? 'on' : '');
      return `<div class="wiz-pill ${cls}">${labels[k]}</div>`;
    }).join('');
  }

  function renderWizPic(box, m) {
    snapshotWizard();
    const st = m.registration_steps || {};
    const geo = m.geo || {};
    box.innerHTML = `
      <div class="wiz-page">
        <h3>Registrasi PIC Merchant</h3>
        <p class="wiz-hint">Lengkapi kartu berurutan. Data tersimpan ke Backend Admin.</p>

        <div class="wiz-box">
          <strong>1. Email ${st.email_verified || m.email_verified ? '✓' : ''}</strong>
          <p class="wiz-hint">${esc(m.email)} ${m.google ? '· Google' : ''}</p>
          <div class="wiz-row">
            <button type="button" class="btn btn-outline btn-sm" id="w-send-email" ${st.email_verified || m.email_verified ? 'disabled' : ''}>Kirim OTP Email</button>
            <input id="w-otp-email" placeholder="Kode OTP" ${st.email_verified || m.email_verified ? 'disabled' : ''}>
            <button type="button" class="btn btn-primary btn-sm" id="w-ver-email" ${st.email_verified || m.email_verified ? 'disabled' : ''}>Verifikasi Email</button>
          </div>
          <p id="w-otp-email-hint" class="wiz-hint" style="margin-top:8px"></p>
        </div>

        <div class="wiz-box">
          <strong>2. Nama Dagang ${st.trade_name_ok ? '✓' : ''}</strong>
          <div class="wiz-row">
            <input id="w-trade" value="${esc(m.trade_name)}" placeholder="Nama dagang unik" ${st.trade_name_ok ? 'readonly' : ''}>
            <button type="button" class="btn btn-outline btn-sm" id="w-check-trade" ${st.trade_name_ok ? 'disabled' : ''}>Cek &amp; Kunci Nama Dagang</button>
          </div>
        </div>

        <div class="wiz-box">
          <strong>3. Verifikasi OCR KTP ${st.kyc_done ? '✓' : ''}</strong>
          <p class="wiz-hint">1) Isi NIK &amp; Nama · 2) Upload foto KTP · 3) Tekan Verifikasi OCR KTP. Foto jelas, tidak blur, tanpa pantulan, landscape.</p>
          <div class="form-group"><label>NIK (16 digit) *</label>
            <input id="w-nik" maxlength="16" inputmode="numeric" value="${esc(m.kyc?.nik||'')}" ${st.kyc_done ? 'readonly style="background:#e8f5e9"' : ''}></div>
          <div class="form-group"><label>Nama Sesuai KTP *</label>
            <input id="w-nama" value="${esc(m.kyc?.nama_ktp||'')}" ${st.kyc_done ? 'readonly style="background:#e8f5e9"' : ''}></div>
          <div class="form-group"><label>Foto KTP *</label>
            <input type="file" id="w-ktp-file" accept="image/*" capture="environment"></div>
          <div id="w-ktp-previews" style="display:flex;gap:10px;flex-wrap:wrap;margin:10px 0">
            <div style="flex:1;min-width:140px;text-align:center">
              <div style="font-size:.75rem;color:#64748b;margin-bottom:4px">Foto KTP (upload)</div>
              <img id="w-ktp-orig" alt="KTP" style="max-width:100%;max-height:120px;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc;${m.kyc?.ktp_image ? '' : 'display:none'}" ${m.kyc?.ktp_image ? 'src="'+m.kyc.ktp_image+'"' : ''}>
            </div>
            <div style="flex:1;min-width:140px;text-align:center">
              <div style="font-size:.75rem;color:#64748b;margin-bottom:4px">Foto Hasil Rekayasa</div>
              <img id="w-ktp-proc" alt="Rekayasa" style="max-width:100%;max-height:120px;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc;${m.kyc?.ktp_processed ? '' : 'display:none'}" ${m.kyc?.ktp_processed ? 'src="'+m.kyc.ktp_processed+'"' : ''}>
            </div>
          </div>
          <div id="w-ocr-out" class="wiz-ok" style="margin:8px 0;font-size:.85rem"></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn btn-primary btn-sm" id="w-ocr">Verifikasi OCR KTP</button>
            <button type="button" class="btn btn-outline btn-sm" id="w-ocr-sim">Verifikasi OCR KTP (simulasi)</button>
          </div>
        </div>

        <div class="wiz-box">
          <strong>4. Lokasi GEO ${st.geo_done ? '✓' : ''}</strong>
          <p class="wiz-hint">Ambil GPS otomatis. Kota/Kabupaten, Kecamatan, Kode Pos <em>tidak dapat diedit</em>.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn btn-outline btn-sm" id="w-geo">Ambil Lokasi GPS</button>
            <button type="button" class="btn btn-outline btn-sm" id="w-geo-sim">Simulasi Lokasi GEO</button>
          </div>
          <div id="w-geo-card" style="margin-top:10px;padding:12px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;font-size:.9rem">
            <div><span style="color:#64748b">Kota/Kabupaten:</span> <strong id="w-geo-kota">${esc(geo.kota || '—')}</strong></div>
            <div><span style="color:#64748b">Kecamatan:</span> <strong id="w-geo-kec">${esc(geo.kecamatan || '—')}</strong></div>
            <div><span style="color:#64748b">Kode Pos:</span> <strong id="w-geo-pos">${esc(geo.kode_pos || '—')}</strong></div>
          </div>
        </div>

        <div class="wiz-box">
          <strong>5a. Syarat &amp; Ketentuan (S&amp;K) ${st.tnc_ok ? '✓' : ''}</strong>
          <div id="w-tnc-scroll" style="max-height:140px;overflow:auto;font-size:.85rem;background:#f8fafc;padding:12px;border-radius:10px;border:1px solid #e2e8f0;white-space:pre-wrap;line-height:1.5">Memuat S&amp;K…</div>
          <button type="button" class="btn btn-outline btn-sm" id="w-tnc-read" style="margin-top:10px" ${st.tnc_ok ? 'disabled' : ''}>Saya telah membaca dan menyetujui</button>
          <label class="wiz-check">
            <input type="checkbox" id="w-tnc" ${st.tnc_ok ? 'checked disabled' : 'disabled'}>
            <span>S&amp;K disetujui</span>
          </label>
        </div>

        <div class="wiz-box">
          <strong>5b. Agreement Pengguna ${st.agreement_ok ? '✓' : ''}</strong>
          <div id="w-agr-scroll" style="max-height:140px;overflow:auto;font-size:.85rem;background:#f8fafc;padding:12px;border-radius:10px;border:1px solid #e2e8f0;white-space:pre-wrap;line-height:1.5">Memuat Agreement…</div>
          <button type="button" class="btn btn-outline btn-sm" id="w-agr-read" style="margin-top:10px" ${st.agreement_ok ? 'disabled' : ''}>Saya telah membaca dan menyetujui</button>
          <label class="wiz-check">
            <input type="checkbox" id="w-agr" ${st.agreement_ok ? 'checked disabled' : 'disabled'}>
            <span>Agreement disetujui</span>
          </label>
        </div>

        <div class="wiz-actions">
          <button type="button" class="btn btn-primary" id="w-pic-next">Simpan &amp; Lanjutkan → UMKM</button>
          ${canShowCancel(m) ? '<button type="button" class="btn btn-outline" id="w-pic-cancel">Batal</button>' : ''}
        </div>
      </div>`;

    function enableOnScroll(scrollId, checkId) {
      const sc = document.getElementById(scrollId);
      const ck = document.getElementById(checkId);
      if (!sc || !ck || ck.disabled) return;
      const tryEnable = () => {
        if (sc.scrollHeight - sc.scrollTop - sc.clientHeight < 24) ck.disabled = false;
      };
      sc.addEventListener('scroll', tryEnable);
      setTimeout(tryEnable, 300);
    }

    fetch('/api/public/config').then(r => r.json()).then(j => {
      const tnc = j.data?.tnc?.registration || j.data?.tnc?.tnc || 'Syarat & Ketentuan bdPay sesuai hukum Indonesia.';
      const agr = j.data?.tnc?.purchase || j.data?.tnc?.agreement || 'Agreement Pengguna bdPay Merchant.';
      const tEl = document.getElementById('w-tnc-scroll');
      const aEl = document.getElementById('w-agr-scroll');
      if (tEl) tEl.textContent = tnc;
      if (aEl) aEl.textContent = agr;
      // Tombol "Saya telah membaca" selalu aktif setelah teks dimuat
      if (!st.tnc_ok) {
        const b = document.getElementById('w-tnc-read'); if (b) b.disabled = false;
        enableOnScroll('w-tnc-scroll', 'w-tnc');
      }
      if (!st.agreement_ok) {
        const b = document.getElementById('w-agr-read'); if (b) b.disabled = false;
        enableOnScroll('w-agr-scroll', 'w-agr');
      }
    }).catch(() => {
      if (!st.tnc_ok) { const b = document.getElementById('w-tnc-read'); if (b) b.disabled = false; }
      if (!st.agreement_ok) { const b = document.getElementById('w-agr-read'); if (b) b.disabled = false; }
    });

    document.getElementById('w-send-email')?.addEventListener('click', async () => {
      const r = await fetch(API + '/otp/send', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ channel: 'email' }) });
      const j = await r.json();
      const hint = document.getElementById('w-otp-email-hint');
      if (j.success && j.data?.demo_otp) {
        if (hint) hint.innerHTML = 'OTP simulasi: <strong style="font-size:1.2rem;letter-spacing:2px;color:#0ea5e9">' + j.data.demo_otp + '</strong> (berlaku 5 menit)';
        const inp = document.getElementById('w-otp-email');
        if (inp) { inp.value = j.data.demo_otp; inp.focus(); }
        toast('OTP dikirim (simulasi): ' + j.data.demo_otp, 'success');
      } else {
        if (hint) hint.textContent = j.message || 'Gagal kirim OTP';
        toast(j.message || 'Gagal', 'error');
      }
    });
    document.getElementById('w-ver-email')?.addEventListener('click', async () => {
      const code = document.getElementById('w-otp-email').value.trim();
      if (!code) { toast('Isi nomor OTP', 'warn'); return; }
      const r = await fetch(API + '/otp/verify', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ channel: 'email', code, otp: code }) });
      const j = await r.json();
      toast(j.success ? 'Email Terverifikasi' : (j.message || 'OTP salah'), j.success ? 'success' : 'error');
      if (j.success) { await refreshMe(); loadRegFlow(); }
    });
    document.getElementById('w-check-trade')?.addEventListener('click', async () => {
      const trade = document.getElementById('w-trade').value.trim();
      if (trade.length < 3) { toast('Nama Dagang minimal 3 karakter', 'warn'); return; }
      toast('Memeriksa ketersediaan Nama Dagang…', 'info');
      const r = await fetch(API + '/verify-trade-name', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ trade_name: trade }) });
      const j = await r.json();
      if (j.success) {
        toast('✓ Nama Dagang tersedia & terverifikasi: ' + trade, 'success');
        const el = document.getElementById('w-trade');
        if (el) { el.readOnly = true; el.style.background = '#e8f5e9'; }
        await refreshMe(); loadRegFlow();
      } else {
        toast(j.message || 'Nama Dagang bentrok / tidak valid', 'error');
      }
    });

    document.getElementById('w-ktp-file')?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const url = await readFileAsDataURL(f);
        const img = document.getElementById('w-ktp-orig');
        if (img) { img.src = url; img.style.display = 'block'; }
      } catch (_) {}
    });

    async function runOcr(bypass) {
      const nik = document.getElementById('w-nik').value.trim();
      const nama = document.getElementById('w-nama').value.trim();
      const file = document.getElementById('w-ktp-file')?.files?.[0];
      const out = document.getElementById('w-ocr-out');
      if (nik.replace(/\D/g, '').length !== 16) { toast('Isi NIK 16 digit', 'warn'); return; }
      if (nama.length < 3) { toast('Isi Nama sesuai KTP', 'warn'); return; }
      if (!bypass && !file) { toast('Upload foto KTP terlebih dahulu', 'warn'); return; }

      // Verifikasi ulang selalu buka kunci
      ['w-nik','w-nama'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !bypass) { el.readOnly = false; el.style.background = ''; }
      });

      if (out) out.innerHTML = '<span style="color:#64748b">Memproses…</span>';

      if (bypass) {
        toast('OCR simulasi…', 'info');
        const r = await fetch(API + '/kyc/ocr', {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({ nik, nama_ktp: nama, bypass: true, image_name: file?.name })
        });
        const j = await r.json();
        if (out) out.innerHTML = '<div style="color:#16a34a"><strong>✓ ' + esc(j.message) + '</strong></div>';
        toast(j.message || '', j.success ? 'success' : 'error');
        if (j.success) setTimeout(async () => { await refreshMe(); loadRegFlow(); }, 500);
        return;
      }

      let imageBase64;
      try { imageBase64 = await readFileAsDataURL(file); }
      catch (e) { toast('Gagal baca file KTP', 'error'); return; }

      const imgOrig = document.getElementById('w-ktp-orig');
      if (imgOrig) { imgOrig.src = imageBase64; imgOrig.style.display = 'block'; }

      let nikUpscale = null, namaUpscale = null, adminProcessed = null;
      let ocrNik = '', ocrNama = '', nikText = '', namaText = '';

      // ——— Proses 1: Upload Ulang (Sharp di server) ———
      if (out) out.innerHTML = '<div><strong>Proses 1/4</strong> Upload Ulang (metadata, blur, anti-palsu)…</div>';
      toast('Proses 1: Validasi upload…', 'info');
      const r1 = await fetch(API + '/kyc/ocr', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          nik, nama_ktp: nama, imageBase64, image_name: file.name,
          ocr_text: '', bypass: false
        })
      });
      const j1 = await r1.json();
      const failCodes = ['BLUR_TOO_HIGH','ANTIFAKE_FAIL','REFLECTION','THIN_PRINT','EDITED_SOFTWARE','INVALID_IMAGE','NO_IMAGE','WATERMARK_DETECTED'];
      const code1 = j1.data?.code || j1.code;
      // quality fail → stop (kecuali server tetap mengembalikan upscale untuk OCR)
      if (!j1.success && failCodes.includes(code1) && !(j1.data?.nik_upscale_image || j1.data?.ktp_processed || j1.data?.processed_image)) {
        if (out) out.innerHTML = '<div style="color:#b91c1c"><strong>Proses 1 gagal</strong> — ' + esc(j1.message) + '</div>';
        toast(j1.message || 'Upload ulang', 'error');
        return;
      }

      nikUpscale = j1.data?.nik_upscale_image || null;
      namaUpscale = j1.data?.nama_upscale_image || j1.data?.verify_image || null;
      adminProcessed = j1.data?.ktp_processed || j1.data?.processed_image || null;
      if (adminProcessed) {
        const imgP = document.getElementById('w-ktp-proc');
        if (imgP) { imgP.src = adminProcessed; imgP.style.display = 'block'; }
      }

      // Client-side 2× upscale fallback if server tidak kirim upscale
      async function upscale2x(dataUrl) {
        return new Promise((resolve) => {
          const im = new Image();
          im.onload = () => {
            const c = document.createElement('canvas');
            c.width = im.width * 2; c.height = im.height * 2;
            const ctx = c.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(im, 0, 0, c.width, c.height);
            resolve(c.toDataURL('image/jpeg', 0.92));
          };
          im.onerror = () => resolve(dataUrl);
          im.src = dataUrl;
        });
      }

      // ——— Proses 2: NIK dari foto upload (upscale 2×) ———
      if (out) out.innerHTML = '<div><strong>Proses 2/4</strong> Verifikasi NIK (Tesseract, upscale 2×)…</div>';
      toast('Proses 2: OCR NIK…', 'info');
      const srcNik = await upscale2x(nikUpscale || imageBase64);
      if (window.KtpOcr && window.Tesseract) {
        try {
          const nikRes = await KtpOcr.recognizeNik(srcNik, (pct) => {
            if (out) out.innerHTML = '<div><strong>Proses 2/4</strong> OCR NIK… ' + pct + '%</div>';
          });
          ocrNik = nikRes.nik || '';
          nikText = nikRes.ocrText || '';
        } catch (e) { console.warn('NIK OCR', e); }
      }

      // ——— Proses 3: Rekayasa sudah di server; pastikan ada foto rekayasa ———
      if (out) out.innerHTML = '<div><strong>Proses 3/4</strong> Foto Hasil Rekayasa siap</div>';
      const srcNamaBase = adminProcessed || namaUpscale || imageBase64;

      // ——— Proses 4: Nama dari foto HASIL REKAYASA + upscale 2× ———
      if (out) out.innerHTML = '<div><strong>Proses 4/4</strong> Verifikasi Nama dari Foto Hasil Rekayasa (upscale 2×)…</div>';
      toast('Proses 4: OCR Nama dari foto rekayasa…', 'info');
      const srcNama = await upscale2x(srcNamaBase);
      if (window.KtpOcr && window.Tesseract) {
        try {
          const namaRes = await KtpOcr.recognizeNama(srcNama, (pct) => {
            if (out) out.innerHTML = '<div><strong>Proses 4/4</strong> OCR Nama… ' + pct + '%</div>';
          });
          ocrNama = namaRes.nama_ktp || namaRes.nama || '';
          namaText = namaRes.ocrText || '';
        } catch (e) { console.warn('Nama OCR', e); }
      }

      // Submit final dengan hasil OCR client
      const r2 = await fetch(API + '/kyc/ocr', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          nik, nama_ktp: nama, imageBase64, image_name: file.name,
          ocr_nik: ocrNik, ocr_nama: ocrNama,
          ocr_text: (nikText + '\n' + namaText).slice(0, 8000),
          engineeredDataUrl: adminProcessed || null,
          bypass: false
        })
      });
      const j = await r2.json();
      const d = j.data || {};
      const o = d.ocr || d;
      const nikSc = o.nik_score != null ? o.nik_score : (d.nik_match != null ? d.nik_match : 0);
      const namaSc = o.nama_score != null ? o.nama_score : (d.nama_match != null ? d.nama_match : 0);
      const lockNik = !!(d.lock_nik || o.nik_match || nikSc >= 50);
      const lockNama = !!(d.lock_nama || o.nama_match || namaSc >= 50);

      if (d.ktp_processed || d.processed_image || adminProcessed) {
        const imgP = document.getElementById('w-ktp-proc');
        if (imgP) { imgP.src = d.ktp_processed || d.processed_image || adminProcessed; imgP.style.display = 'block'; }
      }

      if (out) {
        out.innerHTML =
          '<div style="padding:10px;border-radius:10px;background:' + ((lockNik && lockNama) ? '#ecfdf5' : '#fff7ed') + ';border:1px solid #e2e8f0">' +
          '<div><strong>Proses 1</strong> Upload Ulang ✓</div>' +
          '<div><strong>Proses 2</strong> NIK: OCR <code>' + esc(ocrNik || o.ocr_nik || '—') + '</code> · match <strong>' + nikSc + '%</strong> ' + (lockNik ? '✓ terkunci' : '✗') + '</div>' +
          '<div><strong>Proses 3</strong> Rekayasa Foto ✓ (tampil di preview)</div>' +
          '<div><strong>Proses 4</strong> Nama: OCR <code>' + esc(ocrNama || o.ocr_nama || '—') + '</code> · match <strong>' + namaSc + '%</strong> ' + (lockNama ? '✓ terkunci' : '✗') +
          ' <span style="color:#64748b">(dari foto hasil rekayasa, upscale 2×)</span></div>' +
          '<div style="margin-top:6px">' + esc(j.message || '') + '</div></div>';
      }

      const elN = document.getElementById('w-nik');
      const elM = document.getElementById('w-nama');
      if (elN) {
        if (lockNik) { elN.readOnly = true; elN.style.background = '#e8f5e9'; }
        else { elN.readOnly = false; elN.style.background = '#fff3cd'; }
      }
      if (elM) {
        if (lockNama) { elM.readOnly = true; elM.style.background = '#e8f5e9'; }
        else { elM.readOnly = false; elM.style.background = '#fff3cd'; }
      }

      toast(j.message || '', (lockNik && lockNama) ? 'success' : 'warn');
      if (lockNik && lockNama) setTimeout(async () => { await refreshMe(); loadRegFlow(); }, 700);
    }

    document.getElementById('w-ocr')?.addEventListener('click', () => runOcr(false));
    document.getElementById('w-ocr-sim')?.addEventListener('click', () => runOcr(true));

    async function applyGeoUI(g) {
      document.getElementById('w-geo-kota').textContent = g.kota || g.city || '—';
      document.getElementById('w-geo-kec').textContent = g.kecamatan || '—';
      document.getElementById('w-geo-pos').textContent = g.kode_pos || g.postcode || '—';
    }

    document.getElementById('w-geo')?.addEventListener('click', () => {
      if (!navigator.geolocation) { toast('GPS tidak tersedia — gunakan Simulasi', 'error'); return; }
      toast('Mengambil lokasi GPS…', 'info');
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        try {
          let geoData = { lat, lng };
          try {
            const rr = await fetch('/api/geo/reverse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat, lng }) });
            const jj = await rr.json();
            if (jj.success && jj.data) geoData = Object.assign({}, geoData, jj.data);
            else if (jj.ok) geoData = Object.assign({}, geoData, jj);
          } catch (_) {}
          const r = await fetch(API + '/geo', { method: 'POST', headers: authHeaders(), body: JSON.stringify(geoData) });
          const j = await r.json();
          if (j.success) {
            await applyGeoUI(j.data || geoData);
            toast('Lokasi GEO terverifikasi', 'success');
            setTimeout(() => loadRegFlow(), 400);
          } else toast(j.message || 'Gagal', 'error');
        } catch (e) { toast('Gagal simpan lokasi', 'error'); }
      }, () => toast('Izin lokasi ditolak — gunakan Simulasi Lokasi GEO', 'error'), { enableHighAccuracy: true, timeout: 15000 });
    });

    document.getElementById('w-geo-sim')?.addEventListener('click', async () => {
      const geoData = { lat: -7.2575, lng: 112.7521, kota: 'Surabaya', kecamatan: 'Gubeng', kode_pos: '60281', kelurahan: 'Airlangga', simulation: true };
      const r = await fetch(API + '/geo', { method: 'POST', headers: authHeaders(), body: JSON.stringify(geoData) });
      const j = await r.json();
      if (j.success) {
        await applyGeoUI(j.data || geoData);
        toast('Simulasi Lokasi GEO terverifikasi', 'success');
        setTimeout(() => loadRegFlow(), 400);
      } else toast(j.message || 'Gagal', 'error');
    });

    async function agreeType(type, ckId, btnId) {
      const r = await fetch(API + '/agree', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ type }) });
      const j = await r.json();
      toast(j.message || (type + ' disetujui'), j.success ? 'success' : 'error');
      if (j.success) {
        const ck = document.getElementById(ckId);
        const btn = document.getElementById(btnId);
        if (ck) { ck.checked = true; ck.disabled = true; }
        if (btn) btn.disabled = true;
      }
    }
    document.getElementById('w-tnc-read')?.addEventListener('click', () => agreeType('tnc', 'w-tnc', 'w-tnc-read'));
    document.getElementById('w-agr-read')?.addEventListener('click', () => agreeType('agreement', 'w-agr', 'w-agr-read'));
    document.getElementById('w-tnc')?.addEventListener('change', async (e) => {
      if (!e.target.checked) return;
      await agreeType('tnc', 'w-tnc', 'w-tnc-read');
    });
    document.getElementById('w-agr')?.addEventListener('change', async (e) => {
      if (!e.target.checked) return;
      await agreeType('agreement', 'w-agr', 'w-agr-read');
    });

    document.getElementById('w-pic-cancel')?.addEventListener('click', () => cancelWizardEdits());
    document.getElementById('w-pic-next')?.addEventListener('click', async () => {
      const r = await fetch(API + '/wizard/pic', { method: 'POST', headers: authHeaders(), body: '{}' });
      const j = await r.json();
      toast(j.message || '', j.success ? 'success' : 'error');
      if (j.success) { wizForcePage = null; await refreshMe(); loadRegFlow(); }
    });
  }

  function renderWizUmkm(box, m) {
    snapshotWizard();
    const st = m.registration_steps || {};
    const live = m.liveness || {};
    box.innerHTML = `
      <div class="wiz-page">
        <h3>Registrasi UMKM</h3>
        <p class="wiz-hint">Pilih skala, verifikasi telepon &amp; Liveness. Menengah: unggah dokumen tambahan.</p>

        <div class="wiz-box">
          <strong>1. Kategori UMKM ${st.scale_set ? '✓' : ''}</strong>
          <div class="wiz-row">
            <select id="w-scale" class="wiz-select" ${st.scale_set ? 'disabled' : ''}>
              <option value="">— pilih kategori —</option>
              <option value="mikro" ${m.scale==='mikro'?'selected':''}>Mikro</option>
              <option value="kecil" ${m.scale==='kecil'?'selected':''}>Kecil</option>
              <option value="menengah" ${m.scale==='menengah'?'selected':''}>Menengah</option>
            </select>
            <button type="button" class="btn btn-primary btn-sm" id="w-scale-set" ${st.scale_set ? 'disabled' : ''}>Tetapkan</button>
          </div>
          <p class="wiz-hint" id="w-scale-hint">${st.scale_set ? ('Kategori terkunci: <strong>'+(m.scale||'').toUpperCase()+'</strong>') : 'Pilih kategori lalu tekan Tetapkan'}</p>
        </div>

        <div class="wiz-box">
          <strong>2. OTP Nomor Telepon ${st.phone_verified ? '✓' : ''}</strong>
          <div class="wiz-row">
            <input id="w-phone" placeholder="08xxxxxxxxxx" value="${esc(m.phone||'')}" ${st.phone_verified ? 'readonly' : ''}>
            <button type="button" class="btn btn-outline btn-sm" id="w-send-wa" ${st.phone_verified ? 'disabled' : ''}>Kirim OTP WhatsApp</button>
            <button type="button" class="btn btn-outline btn-sm" id="w-send-sms" ${st.phone_verified ? 'disabled' : ''}>Kirim OTP SMS</button>
            <input id="w-phone-otp" placeholder="Nomor OTP" ${st.phone_verified ? 'disabled' : ''}>
            <button type="button" class="btn btn-primary btn-sm" id="w-ver-phone" ${st.phone_verified ? 'disabled' : ''}>Verifikasi</button>
          </div>
          <p id="w-phone-hint" class="wiz-hint" style="margin-top:8px"></p>
        </div>

        <div class="wiz-box">
          <strong>3. Liveness Detection ${live.passed || st.liveness_ok ? '✓' : ''}</strong>
          <p class="wiz-hint"><strong>Lihat ke Kamera selama 1 menit</strong>, lihat Progress Bar, <strong>ketuk layar beberapa kali</strong>, tunggu progress sampai <strong>100%</strong>. Foto hasil liveness disimpan.</p>
          <div class="wiz-progress-bar"><i id="live-progress-bar" style="width:0%"></i></div>
          <div class="wiz-progress-label" id="live-progress-label">Keberhasilan: 0%</div>
          <div id="live-stage" style="position:relative;max-width:360px;margin:10px auto;background:#0f172a;border-radius:16px;overflow:hidden;aspect-ratio:3/4;display:none">
            <video id="live-video" playsinline autoplay muted style="width:100%;height:100%;object-fit:cover"></video>
            <canvas id="live-overlay" style="position:absolute;inset:0;width:100%;height:100%"></canvas>
            <div id="live-guide" style="position:absolute;inset:12% 18%;border:2px dashed rgba(251,191,36,.7);border-radius:50% 50% 45% 45%;pointer-events:none"></div>
            <div id="live-status" style="position:absolute;left:0;right:0;bottom:0;padding:10px;background:rgba(0,0,0,.55);color:#f8fafc;font-size:.85rem;text-align:center">Siap</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:8px">
            <button type="button" class="btn btn-primary btn-sm" id="w-live-start" ${live.passed||st.liveness_ok?'disabled':''}>Mulai Liveness</button>
            <button type="button" class="btn btn-outline btn-sm" id="w-live-sim" ${live.passed||st.liveness_ok?'disabled':''}>Mulai Liveness (Simulasi)</button>
          </div>
          <div id="live-photo-wrap" style="margin-top:10px;text-align:center">
            ${(() => {
              let ph = live.photo;
              if (!ph) { try { ph = sessionStorage.getItem('m_live_photo'); } catch(_){} }
              if (!ph) return '';
              return '<img src="'+ph+'" alt="Liveness" style="max-width:160px;border-radius:12px;border:2px solid #22c55e">' +
                (live.passed || st.liveness_ok ? '<p class="wiz-hint" style="color:#16a34a">Skor: '+(live.score||0)+'% · '+(live.simulation?'Simulasi':'Real')+' · foto tersimpan</p>' : '<p class="wiz-hint">Foto liveness</p>');
            })()}
          </div>
        </div>

        <div class="wiz-box" id="w-docs-box" style="${m.scale==='menengah'?'':'display:none'}">
          <strong>4. Dokumen Menengah</strong>
          <p class="wiz-hint">Upload 4 Dokumen, Tekan Verifikasi OCR, Tunggu Hasil. Pastikan Dokumen tidak Blur, tidak ada Pantulan Sinar dan Tidak Rusak.</p>
          ${(() => {
            const d = m.scale_docs || {};
            const card = (key, title, fields) => {
              const x = d[key] || {};
              const ok = !!x.verified;
              return '<div class="wiz-box doc-card" data-doc="'+key+'" style="margin:10px 0;background:#f8fafc">' +
                '<strong>'+title+(ok?' ✓':'')+'</strong>' +
                fields +
                '<div class="wiz-row" style="margin-top:8px">' +
                '<input type="file" class="doc-file" data-doc="'+key+'" accept="image/*" '+(ok?'disabled':'')+'>' +
                '</div>' +
                '<div class="doc-previews" data-doc="'+key+'" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">' +
                (x.image ? '<img src="'+x.image+'" style="max-height:100px;border-radius:8px;border:1px solid #e2e8f0" alt="upload">' : '') +
                (x.processed_image ? '<img src="'+x.processed_image+'" style="max-height:100px;border-radius:8px;border:1px solid #e2e8f0" alt="rekayasa">' : '') +
                '</div>' +
                '<div class="wiz-row" style="margin-top:8px">' +
                '<button type="button" class="btn btn-primary btn-sm doc-ocr" data-doc="'+key+'" '+(ok?'disabled':'')+'>Verifikasi OCR</button>' +
                '<button type="button" class="btn btn-outline btn-sm doc-sim" data-doc="'+key+'" '+(ok?'disabled':'')+'>Verifikasi Simulasi</button>' +
                '</div>' +
                '<p class="doc-out wiz-hint" data-doc="'+key+'" style="margin-top:6px">'+(ok?('Terverifikasi '+(x.match_percent||'')+'%'):'')+'</p>' +
                '</div>';
            };
            const kd = d.ktp_direksi || {};
            const np = d.npwp_direksi || {};
            const ak = d.akta_notaris || {};
            const sk = d.sk_kemenkumham || {};
            return (
              card('ktp_direksi', '1) KTP Direksi',
                '<div class="form-group"><label>NIK Direksi *</label><input class="doc-nik" data-doc="ktp_direksi" maxlength="16" value="'+(kd.number||kd.nik||'')+'" '+(kd.verified?'readonly style="background:#e8f5e9"':'')+'></div>' +
                '<div class="form-group"><label>Nama Direksi *</label><input class="doc-nama" data-doc="ktp_direksi" value="'+(kd.nama||'')+'" '+(kd.verified?'readonly style="background:#e8f5e9"':'')+'></div>') +
              card('npwp_direksi', '2) NPWP',
                '<div class="form-group"><label>Nomor NPWP *</label><input class="doc-num" data-doc="npwp_direksi" value="'+(np.number||'')+'" '+(np.verified?'readonly style="background:#e8f5e9"':'')+'></div>') +
              card('akta_notaris', '3) Akta Perusahaan',
                '<div class="form-group"><label>Nomor Akta *</label><input class="doc-num" data-doc="akta_notaris" value="'+(ak.number||'')+'" '+(ak.verified?'readonly style="background:#e8f5e9"':'')+'></div>') +
              card('sk_kemenkumham', '4) SK KEMENKUMHAM',
                '<div class="form-group"><label>Nomor SK KEMENKUMHAM *</label><input class="doc-num" data-doc="sk_kemenkumham" value="'+(sk.number||'')+'" '+(sk.verified?'readonly style="background:#e8f5e9"':'')+'></div>')
            );
          })()}
        </div>

        <div class="wiz-actions">
          <button type="button" class="btn btn-outline" id="w-umkm-back">← Kembali</button>
          <button type="button" class="btn btn-primary" id="w-umkm-next">Simpan &amp; Lanjutkan → Kuesioner</button>
          ${canShowCancel(m) ? '<button type="button" class="btn btn-outline" id="w-umkm-cancel">Batal</button>' : ''}
        </div>
      </div>`;

    document.getElementById('w-scale-set')?.addEventListener('click', async () => {
      const sel = document.getElementById('w-scale');
      const scale = sel?.value || '';
      if (!scale) { toast('Pilih kategori terlebih dahulu', 'warn'); return; }
      const r = await fetch(API + '/set-scale-only', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ scale })
      });
      const j = await r.json();
      if (!j.success) { toast(j.message || 'Gagal menetapkan kategori', 'error'); return; }
      if (sel) sel.disabled = true;
      const btn = document.getElementById('w-scale-set');
      if (btn) btn.disabled = true;
      const hint = document.getElementById('w-scale-hint');
      if (hint) hint.innerHTML = 'Kategori terkunci: <strong>' + scale.toUpperCase() + '</strong>';
      const box = document.getElementById('w-docs-box');
      if (box) box.style.display = scale === 'menengah' ? '' : 'none';
      toast('Kategori ' + scale.toUpperCase() + ' ditetapkan', 'success');
      await refreshMe();
    });
    // preview docs visibility on change (before tetapkan)
    document.getElementById('w-scale')?.addEventListener('change', (e) => {
      // hanya preview; kunci setelah Tetapkan
      const box = document.getElementById('w-docs-box');
      if (box && !document.getElementById('w-scale')?.disabled) {
        box.style.display = e.target.value === 'menengah' ? '' : 'none';
      }
    });

    // —— Dokumen Menengah: simpan preview file ——
    document.querySelectorAll('.doc-file').forEach(inp => {
      inp.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        const key = e.target.dataset.doc;
        if (!file || !key) return;
        try {
          if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
            toast('Upload file gambar (JPG/PNG)', 'warn');
            return;
          }
          if (file.size > 8 * 1024 * 1024) {
            toast('File max 8MB', 'warn');
            return;
          }
          toast('Menyimpan dokumen…', 'info');
          const b64 = await readFileAsDataURL(file);
          e.target._dataUrl = b64;
          e.target._fileName = file.name;
          docFileCache[key] = { dataUrl: b64, name: file.name };
          const prev = document.querySelector('.doc-previews[data-doc="'+key+'"]');
          if (prev) prev.innerHTML = '<img src="'+b64+'" style="max-height:100px;border-radius:8px;border:1px solid #e2e8f0" alt="upload">';
          // Simpan ke server dulu
          const r = await fetch(API + '/docs/upload', {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({ doc_type: key, image: b64, file_name: file.name })
          });
          const j = await r.json();
          if (j.success) toast('Dokumen tersimpan — siap Verifikasi OCR', 'success');
          else toast(j.message || 'Gagal simpan dokumen', 'warn');
        } catch (err) {
          console.error(err);
          toast('Gagal baca/simpan file: ' + (err.message || err), 'error');
        }
      });
    });

    function matchScore(a, b) {
      a = String(a||'').toUpperCase().replace(/\s+/g,' ').trim();
      b = String(b||'').toUpperCase().replace(/\s+/g,' ').trim();
      if (!a || !b) return 0;
      if (a === b) return 100;
      // digit-only compare
      const da = a.replace(/\D/g,''), db = b.replace(/\D/g,'');
      if (da && db && da === db) return 100;
      let same = 0;
      const len = Math.max(a.length, b.length);
      for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] === b[i]) same++;
      return Math.round((same / len) * 100);
    }
    async function upscale2x(dataUrl) {
      return new Promise((resolve) => {
        const im = new Image();
        im.onload = () => {
          const c = document.createElement('canvas');
          c.width = im.width * 2; c.height = im.height * 2;
          const ctx = c.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(im, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.92));
        };
        im.onerror = () => resolve(dataUrl);
        im.src = dataUrl;
      });
    }

    async function verifyDocSim(key) {
      let number = '', nama = '';
      if (key === 'ktp_direksi') {
        number = document.querySelector('.doc-nik[data-doc="'+key+'"]')?.value.trim() || '';
        nama = document.querySelector('.doc-nama[data-doc="'+key+'"]')?.value.trim() || '';
        if (number.replace(/\D/g,'').length !== 16) { toast('Isi NIK Direksi 16 digit', 'warn'); return; }
        if (nama.length < 3) { toast('Isi Nama Direksi', 'warn'); return; }
      } else {
        number = document.querySelector('.doc-num[data-doc="'+key+'"]')?.value.trim() || '';
        if (number.length < 2) { toast('Isi nomor dokumen', 'warn'); return; }
      }
      const fileInp = document.querySelector('.doc-file[data-doc="'+key+'"]');
      const image = fileInp?._dataUrl || null;
      const r = await fetch(API + '/docs/verify-sim', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ doc_type: key, number, nama, file_name: fileInp?._fileName, image })
      });
      const j = await r.json();
      toast(j.message || '', j.success ? 'success' : 'error');
      if (j.success) { await refreshMe(); loadRegFlow(); }
    }

    async function verifyDocOcr(key) {
      const out = document.querySelector('.doc-out[data-doc="'+key+'"]');
      const fileInp = document.querySelector('.doc-file[data-doc="'+key+'"]');
      const keyCache = docFileCache[key] || {};
      let imageBase64 = fileInp?._dataUrl || keyCache.dataUrl || null;
      try {
        if (!imageBase64) {
          const f = fileInp?.files?.[0];
          if (!f) { toast('Upload foto dokumen dulu', 'warn'); return; }
          imageBase64 = await readFileAsDataURL(f);
          fileInp._dataUrl = imageBase64;
          docFileCache[key] = { dataUrl: imageBase64, name: f.name };
        }
      } catch (e) {
        console.error(e);
        toast('Gagal baca file: ' + (e && e.message ? e.message : e), 'error');
        return;
      }

      let number = '', nama = '';
      if (key === 'ktp_direksi') {
        number = document.querySelector('.doc-nik[data-doc="'+key+'"]')?.value.trim() || '';
        nama = document.querySelector('.doc-nama[data-doc="'+key+'"]')?.value.trim() || '';
        if (number.replace(/\D/g,'').length !== 16) { toast('Isi NIK Direksi 16 digit', 'warn'); return; }
        if (nama.length < 3) { toast('Isi Nama Direksi', 'warn'); return; }
      } else {
        number = document.querySelector('.doc-num[data-doc="'+key+'"]')?.value.trim() || '';
        if (number.length < 2) { toast('Isi nomor dokumen', 'warn'); return; }
      }

      // KTP Direksi: metode sama dengan OCR PIC Merchant (/kyc/ocr)
      if (key === 'ktp_direksi') {
        if (out) out.textContent = 'Menyimpan & verifikasi OCR KTP Direksi (metode PIC)…';
        try {
          // simpan dulu
          await fetch(API + '/wizard/docs', {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({
              doc_type: key, number, nama, imageBase64,
              image_name: fileInp?._fileName || 'ktp-direksi.jpg', verified: false
            })
          });
          const rO = await fetch(API + '/kyc/ocr', {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({
              nik: number.replace(/\D/g, ''),
              nama_ktp: nama,
              imageBase64,
              image_name: fileInp?._fileName || 'ktp-direksi.jpg',
              role: 'ktp_direksi'
            })
          });
          const jO = await rO.json();
          const dO = jO.data || {};
          const nikOk = !!(jO.success && (dO.nik_verified || dO.nik_score >= 50 || dO.verified));
          const namaOk = !!(jO.success && (dO.nama_verified || dO.nama_score >= 50 || dO.verified));
          const both = nikOk && namaOk && jO.success;
          // simpan hasil
          await fetch(API + '/wizard/docs', {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({
              doc_type: key, number, nama, imageBase64,
              image_name: fileInp?._fileName || 'ktp-direksi.jpg',
              verified: both,
              ocr: dO,
              processed_image: dO.processed_image || dO.image_processed || null
            })
          });
          if (out) {
            out.innerHTML = both
              ? '<span style="color:#16a34a">✓ KTP Direksi terverifikasi (NIK & Nama ≥50%, metode PIC)</span>'
              : '<span style="color:#b45309">NIK: ' + (dO.nik_score != null ? dO.nik_score : '?') + '% · Nama: ' + (dO.nama_score != null ? dO.nama_score : '?') + '% — ' + esc(jO.message || 'Perbaiki input / foto, file tetap tersimpan') + '</span>';
          }
          toast(jO.message || (both ? 'KTP Direksi OK' : 'Verifikasi belum lulus — file tersimpan'), both ? 'success' : 'warn');
          if (both) {
            const nikEl = document.querySelector('.doc-nik[data-doc="'+key+'"]');
            const namaEl = document.querySelector('.doc-nama[data-doc="'+key+'"]');
            if (nikEl) { nikEl.readOnly = true; nikEl.style.background = '#e8f5e9'; }
            if (namaEl) { namaEl.readOnly = true; namaEl.style.background = '#e8f5e9'; }
          }
          await refreshMe();
          return;
        } catch (e) {
          toast('OCR Direksi gagal: ' + e.message, 'error');
          // lanjut fallback ke pipeline lama di bawah
        }
      }

      if (out) out.textContent = 'Proses 1/4: Validasi upload…';
      toast('Memulai Verifikasi OCR…', 'info');

      // Proses 1: server quality check
      let processed = null;
      try {
        const r1 = await fetch(API + '/docs/verify-ocr', {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({
            doc_type: key, number, nama, imageBase64,
            image_name: fileInp?._fileName || 'doc.jpg', phase: 'upload'
          })
        });
        const j1 = await r1.json();
        const code1 = j1.data?.code || j1.code;
        // Selalu simpan dokumen ke sistem (meski diminta upload ulang)
        try {
          await fetch(API + '/wizard/docs', {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({
              doc_type: key,
              number: number,
              nama: nama,
              imageBase64: imageBase64,
              image_name: fileInp?._fileName || (keyCache.name) || 'doc.jpg',
              verified: false,
              pending_reupload: !!(code1 && ['BLUR_TOO_HIGH','ANTIFAKE_FAIL','REFLECTION','THIN_PRINT','EDITED_SOFTWARE','INVALID_IMAGE'].includes(code1))
            })
          });
        } catch (_) {}
        if (!j1.success && code1 && ['BLUR_TOO_HIGH','ANTIFAKE_FAIL','REFLECTION','THIN_PRINT','EDITED_SOFTWARE','INVALID_IMAGE'].includes(code1)) {
          if (out) out.textContent = (j1.message || 'Upload ulang') + ' — foto sebelumnya tetap tersimpan.';
          toast((j1.message || 'Upload ulang dokumen') + ' (file tetap disimpan)', 'error');
          return;
        }
        processed = j1.data?.processed_image || null;
        if (processed) {
          const prev = document.querySelector('.doc-previews[data-doc="'+key+'"]');
          if (prev) {
            prev.innerHTML = '<img src="'+imageBase64+'" style="max-height:100px;border-radius:8px;border:1px solid #e2e8f0" alt="upload">' +
              '<img src="'+processed+'" style="max-height:100px;border-radius:8px;border:1px solid #e2e8f0" alt="rekayasa">';
          }
        }
      } catch (e) {
        console.warn('upload phase', e);
        toast('Gagal validasi upload — lanjut OCR lokal', 'warn');
      }

      if (!window.KtpOcr) {
        toast('Modul OCR belum dimuat. Hard refresh (Ctrl+Shift+R) atau gunakan Verifikasi Simulasi.', 'error');
        if (out) out.textContent = 'KtpOcr/Tesseract tidak tersedia';
        return;
      }

      let ocrNik = '', ocrNama = '', ocrNum = '', ocrText = '';
      const srcUp = await upscale2x(imageBase64);

      try {
        if (key === 'ktp_direksi') {
          // Proses 2: NIK
          if (out) out.textContent = 'Proses 2/4: OCR NIK (upscale 2×)…';
          const nikRes = await KtpOcr.recognizeNik(srcUp, (p) => {
            if (out) out.textContent = 'Proses 2/4: OCR NIK ' + p + '%';
          });
          ocrNik = nikRes.nik || '';
          ocrText += (nikRes.ocrText || '') + '\n';

          // Proses 3–4: Nama — sama seperti PIC: foto rekayasa + upscale 2×, fallback original
          if (out) out.textContent = 'Proses 3–4/4: OCR Nama dari foto rekayasa…';
          const srcNamaA = await upscale2x(processed || imageBase64);
          let namaRes = await KtpOcr.recognizeNama(srcNamaA, (p) => {
            if (out) out.textContent = 'Proses 4/4: OCR Nama (rekayasa) ' + p + '%';
          });
          ocrNama = namaRes.nama_ktp || namaRes.nama || '';
          ocrText += (namaRes.ocrText || '') + '\n';
          // Strategi B (seperti PIC): jika kosong, baca dari original upscale
          if (!ocrNama || ocrNama.length < 3) {
            if (out) out.textContent = 'Proses 4/4: OCR Nama (fallback original)…';
            const srcNamaB = await upscale2x(imageBase64);
            namaRes = await KtpOcr.recognizeNama(srcNamaB, (p) => {
              if (out) out.textContent = 'OCR Nama fallback ' + p + '%';
            });
            ocrNama = namaRes.nama_ktp || namaRes.nama || ocrNama;
            ocrText += (namaRes.ocrText || '') + '\n';
          }
        } else {
          // NPWP / Akta / SK — ekstrak digit via recognizeNik path (whitelist angka)
          if (out) out.textContent = 'OCR nomor dokumen…';
          const digRes = await KtpOcr.recognizeNik(srcUp, (p) => {
            if (out) out.textContent = 'OCR nomor ' + p + '%';
          });
          ocrText = digRes.ocrText || '';
          const raw = ocrText + ' ' + (digRes.nik || '');

          function mapDigits(s) {
            return String(s)
              .replace(/[OoDdQqCc]/g, '0').replace(/[Ii]/g, '1')
              .replace(/[Bb]/g, '8').replace(/[Tt]/g, '7')
              .replace(/[Aa]/g, '4').replace(/[Ss]/g, '5')
              .replace(/[Gg]/g, '6');
          }

          if (key === 'npwp_direksi') {
            // NPWP: 15–16 digit
            const ms = mapDigits(raw).match(/[0-9]{15,16}/g) || [];
            ocrNum = ms[0] || (digRes.nik || '');
          } else if (key === 'akta_notaris') {
            const m1 = raw.match(/(?:Akta)\s*[:;\-]?\s*([0-9BTOoIiSsADQGCc]{2,})/i);
            ocrNum = m1 ? mapDigits(m1[1]).replace(/\D/g,'') : (mapDigits(raw).match(/[0-9]{2,}/) || [''])[0];
          } else if (key === 'sk_kemenkumham') {
            const m1 = raw.match(/(?:Nomor\s*SK|No\.?\s*SK|SK)\s*[:;\-]?\s*([0-9BTOoIiSsADQGCc\-\/]{8,})/i);
            if (m1) ocrNum = mapDigits(m1[1]);
            else {
              const ms = mapDigits(raw).match(/[0-9]{10,}/g) || [];
              ocrNum = ms.sort((a,b)=>b.length-a.length)[0] || '';
            }
          }
        }
      } catch (e) {
        console.error('OCR client', e);
        toast('OCR gagal: ' + (e.message || e) + ' — coba foto lebih jelas atau Simulasi', 'error');
        if (out) out.textContent = 'OCR error: ' + (e.message || e);
        return;
      }

      // skor matching
      function matchScore(a, b) {
        a = String(a||'').toUpperCase().replace(/\s+/g,' ').trim();
        b = String(b||'').toUpperCase().replace(/\s+/g,' ').trim();
        if (!a || !b) return 0;
        if (a === b) return 100;
        const da = a.replace(/\D/g,''), db = b.replace(/\D/g,'');
        if (da && db && da === db) return 100;
        if (da && db && (da.includes(db) || db.includes(da))) return 70;
        let same = 0;
        const len = Math.max(a.length, b.length) || 1;
        for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] === b[i]) same++;
        return Math.round((same / len) * 100);
      }

      function nameMatchScore(userNama, ocrNamaVal) {
        const norm = (s) => String(s || '').toUpperCase()
          .replace(/0/g,'O').replace(/1/g,'I').replace(/5/g,'S').replace(/8/g,'B')
          .replace(/[^A-Z\s.,']/g, ' ').replace(/\s+/g, ' ').trim();
        const a = norm(userNama), b = norm(ocrNamaVal);
        if (!a || !b) return 0;
        if (a === b) return 100;
        if (a.includes(b) || b.includes(a)) return 88;
        const ta = a.split(' ').filter((t) => t.length > 1);
        const tb = b.split(' ').filter((t) => t.length > 1);
        if (!ta.length || !tb.length) return matchScore(a, b);
        let hit = 0;
        ta.forEach((t) => {
          if (tb.some((x) => x === t || x.indexOf(t) === 0 || t.indexOf(x) === 0 || (t.length > 3 && x.includes(t)) || (x.length > 3 && t.includes(x)))) hit++;
        });
        const ratio = hit / Math.max(ta.length, tb.length);
        return Math.round(ratio * 100);
      }

      let nikScore = 0, namaScore = 0, numScore = 0;
      if (key === 'ktp_direksi') {
        nikScore = matchScore(number.replace(/\D/g,''), ocrNik);
        namaScore = nameMatchScore(nama, ocrNama);
        // jika NIK bagus tapi nama OCR kosong, longgarkan: pakai partial dari ocrText
        if (namaScore < 50 && ocrText) {
          const alt = nameMatchScore(nama, ocrText);
          if (alt > namaScore) namaScore = alt;
        }
      } else {
        numScore = matchScore(number.replace(/\D/g,''), String(ocrNum).replace(/\D/g,''));
        if (numScore < 50) numScore = Math.max(numScore, matchScore(number, ocrText));
      }

      if (out) {
        if (key === 'ktp_direksi') {
          out.innerHTML = 'NIK OCR: <code>'+(ocrNik||'—')+'</code> <strong>'+nikScore+'%</strong> · Nama OCR: <code>'+(ocrNama||'—')+'</code> <strong>'+namaScore+'%</strong>';
        } else {
          out.innerHTML = 'OCR: <code>'+(ocrNum||'—')+'</code> match <strong>'+numScore+'%</strong>';
        }
      }

      const r2 = await fetch(API + '/docs/verify-ocr', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          doc_type: key, number, nama, imageBase64,
          image_name: fileInp?._fileName || 'doc.jpg',
          ocr_nik: ocrNik, ocr_nama: ocrNama, ocr_number: ocrNum,
          ocr_text: ocrText.slice(0, 8000),
          nik_score: nikScore, nama_score: namaScore, number_score: numScore,
          processed_image: processed, phase: 'final'
        })
      });
      const j2 = await r2.json();
      toast(j2.message || '', j2.success ? 'success' : 'warn');
      if (out) out.innerHTML += '<br>' + (j2.message || '');
      if (j2.success) {
        await refreshMe();
        setTimeout(() => loadRegFlow(), 400);
      }
    }

    document.querySelectorAll('.doc-file').forEach(inp => {
      inp.addEventListener('change', async (e) => {
        const f = e.target.files && e.target.files[0];
        const key = inp.dataset.doc;
        if (!f || !key) return;
        try {
          let dataUrl = await readFileAsDataURL(f);
          try { dataUrl = await compressDataUrl(dataUrl, 900, 0.72); } catch (_) {}
          inp._dataUrl = dataUrl;
          inp._fileName = f.name;
          docFileCache[key] = { dataUrl, name: f.name };
          const prev = document.querySelector('.doc-prev[data-doc="'+key+'"]');
          if (prev) { prev.src = dataUrl; prev.style.display = 'block'; }
          // simpan ke server segera (URL publik)
          const r = await fetch(API + '/docs/upload', {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({ doc_type: key, file_name: f.name, file_size: f.size, image: dataUrl })
          });
          const j = await r.json();
          if (j.success && j.data && j.data.image && String(j.data.image).startsWith('/media/')) {
            docFileCache[key].serverUrl = j.data.image;
            toast('Dokumen disimpan', 'success');
          } else if (!j.success) toast(j.message || 'Gagal simpan dokumen', 'warn');
        } catch (err) {
          toast('Gagal baca/simpan file', 'error');
        }
      });
    });
    document.querySelectorAll('.doc-sim').forEach(btn => {
      btn.addEventListener('click', () => verifyDocSim(btn.dataset.doc));
    });
    document.querySelectorAll('.doc-ocr').forEach(btn => {
      btn.addEventListener('click', () => verifyDocOcr(btn.dataset.doc));
    });


    async function sendPhoneOtp(channel) {
      const phone = document.getElementById('w-phone').value.trim();
      if (!phone) { toast('Isi nomor telepon', 'warn'); return; }
      window.__lastPhoneOtpChannel = channel;
      const r = await fetch(API + '/otp/send', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ channel, target: phone, phone }) });
      const j = await r.json();
      const h = document.getElementById('w-phone-hint');
      if (j.success && j.data?.demo_otp) {
        if (h) h.innerHTML = 'OTP ' + channel.toUpperCase() + ' simulasi: <strong style="letter-spacing:2px;color:#0ea5e9">' + j.data.demo_otp + '</strong>';
        const inp = document.getElementById('w-phone-otp'); if (inp) inp.value = j.data.demo_otp;
        toast('OTP dikirim via ' + channel.toUpperCase() + ': ' + j.data.demo_otp, 'success');
      } else {
        if (h) h.textContent = j.message || 'Gagal';
        toast(j.message || 'Gagal', 'error');
      }
    }
    document.getElementById('w-send-wa')?.addEventListener('click', () => sendPhoneOtp('wa'));
    document.getElementById('w-send-sms')?.addEventListener('click', () => sendPhoneOtp('sms'));
    document.getElementById('w-send-phone')?.addEventListener('click', () => sendPhoneOtp('sms'));
    document.getElementById('w-ver-phone')?.addEventListener('click', async () => {
      const code = document.getElementById('w-phone-otp').value.trim();
      const phone = document.getElementById('w-phone').value.trim();
      if (!code) { toast('Isi nomor OTP', 'warn'); return; }
      const ch = window.__lastPhoneOtpChannel || 'phone';
      const r = await fetch(API + '/otp/verify', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ channel: ch, code, otp: code, phone })
      });
      const j = await r.json();
      toast(j.success ? 'Nomor telepon terverifikasi' : (j.message || 'Gagal'), j.success ? 'success' : 'error');
      if (j.success) { await refreshMe(); loadRegFlow(); }
    });

    let liveStream = null;
    let liveTimer = null;
    let liveTick = null;

    async function stopLive() {
      if (liveTimer) clearTimeout(liveTimer);
      if (liveTick) clearInterval(liveTick);
      if (liveStream) { liveStream.getTracks().forEach(t => t.stop()); liveStream = null; }
    }

    async function submitLiveness(payload) {
      if (payload.photo) {
        try {
          payload.photo = await compressDataUrl(payload.photo, 320, 0.55);
        } catch (_) {}
      }
      if (!payload.photo) {
        toast('Foto liveness belum tertangkap — ulangi dengan kamera aktif', 'warn');
      }
      const r = await fetch(API + '/liveness', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify(payload)
      });
      const j = await r.json();
      toast(j.message || '', j.success ? 'success' : 'error');
      if (j.success) {
        await stopLive();
        const ph = (j.data && j.data.photo) || payload.photo;
        // simpan lokal agar tetap tampil setelah re-render
        if (ph) {
          try { sessionStorage.setItem('m_live_photo', ph); } catch (_) {}
        }
        const wrap = document.getElementById('live-photo-wrap');
        if (wrap && ph) {
          wrap.innerHTML = '<img src="'+ph+'" alt="Liveness" style="max-width:160px;border-radius:12px;border:2px solid #22c55e">' +
            '<p class="wiz-hint" style="color:#16a34a">Skor: '+(j.data?.score||payload.score||0)+'% · foto tersimpan</p>';
        }
        await refreshMe();
        setTimeout(() => loadRegFlow(), 600);
      }
      return j;
    }

    document.getElementById('w-live-sim')?.addEventListener('click', async () => {
      // canvas photo placeholder
      const c = document.createElement('canvas'); c.width = 240; c.height = 320;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#1e293b'; ctx.fillRect(0,0,240,320);
      ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 16px sans-serif'; ctx.fillText('Liveness Sim', 60, 160);
      const photo = c.toDataURL('image/jpeg', 0.7);
      await submitLiveness({ passed: true, score: 85, frames: 5, simulation: true, photo });
    });

    document.getElementById('w-live-start')?.addEventListener('click', async () => {
      const stage = document.getElementById('live-stage');
      const video = document.getElementById('live-video');
      const overlay = document.getElementById('live-overlay');
      const status = document.getElementById('live-status');
      const bar = document.getElementById('live-progress-bar');
      const lab = document.getElementById('live-progress-label');
      if (stage) stage.style.display = 'block';
      try {
        liveStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        video.srcObject = liveStream;
        await video.play();
      } catch (e) {
        toast('Kamera tidak dapat diakses. Gunakan simulasi.', 'error');
        return;
      }

      // Logika mudah browser: hadapkan wajah ke oval, tahan, kedipkan (klik), tengok (klik tantangan)
      const TOTAL_MS = 60 * 1000;
      const PHOTO_AT = 5 * 1000;
      const t0 = Date.now();
      let score = 0;
      let photoTaken = null;
      let step = 0; // 0 hadap, 1 kedip, 2 tengok, 3 tahan
      const steps = ['Hadapkan wajah di oval', 'Kedipkan mata (atau ketuk Layar)', 'Tengok kiri/kanan (ketuk)', 'Tahan posisi sampai selesai'];
      if (status) status.textContent = steps[0] + ' · 0%';

      // Tap to advance challenge (mudah di browser tanpa ML)
      const onTap = () => {
        if (step < 3) {
          step++;
          score = Math.min(100, score + 25);
          if (bar) bar.style.width = score + '%';
          if (lab) lab.textContent = 'Keberhasilan: ' + score + '%';
          if (status) status.textContent = (steps[step] || 'Selesai') + ' · ' + score + '%';
        }
      };
      stage.onclick = onTap;
      overlay.style.pointerEvents = 'none';

      const ctx = overlay.getContext('2d');
      const tick = () => {
        if (!liveStream) return;
        const elapsed = Date.now() - t0;
        const remain = Math.max(0, Math.ceil((TOTAL_MS - elapsed) / 1000));
        // passive progress: presence of video frames
        if (video.readyState >= 2 && score < 40) {
          score = Math.min(40, score + 0.4);
        }
        if (bar) bar.style.width = Math.round(score) + '%';
        if (lab) lab.textContent = 'Keberhasilan: ' + Math.round(score) + '% · sisa ' + remain + 's';
        if (status) status.textContent = (steps[step] || 'Selesai') + ' · ketuk layar untuk tantangan · sisa ' + remain + 's';

        overlay.width = video.videoWidth || 320;
        overlay.height = video.videoHeight || 420;
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        ctx.strokeStyle = score >= 50 ? 'rgba(34,197,94,0.9)' : 'rgba(251,191,36,0.85)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(overlay.width/2, overlay.height*0.45, overlay.width*0.28, overlay.height*0.32, 0, 0, Math.PI*2);
        ctx.stroke();

        // Tangkap foto berkala sejak detik 3 (retry sampai berhasil)
        if (elapsed >= 3000 && (!photoTaken || (elapsed >= PHOTO_AT && elapsed < PHOTO_AT + 2000))) {
          try {
            const vw = video.videoWidth || 0;
            const vh = video.videoHeight || 0;
            if (vw > 16 && vh > 16 && video.readyState >= 2) {
              const c = document.createElement('canvas');
              c.width = Math.min(vw, 640);
              c.height = Math.round(c.width * (vh / vw));
              c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
              const shot = c.toDataURL('image/jpeg', 0.85);
              if (shot && shot.length > 1000) {
                photoTaken = shot;
                const wrap = document.getElementById('live-photo-wrap');
                if (wrap) {
                  wrap.innerHTML = '<img src="'+photoTaken+'" alt="Liveness" style="max-width:160px;border-radius:12px;border:2px solid #22c55e">' +
                    '<p class="wiz-hint" style="color:#16a34a;margin-top:4px">Foto liveness tertangkap</p>';
                }
              }
            }
          } catch (e) { console.warn('liveness capture', e); }
        }
        // skor naik jika frame aktif
        if (video.readyState >= 2) score = Math.min(100, score + 0.15);

        if (elapsed >= TOTAL_MS || score >= 100) {
          // pastikan ada foto sebelum submit
          if (!photoTaken && video.readyState >= 2) {
            try {
              const c = document.createElement('canvas');
              c.width = video.videoWidth || 320; c.height = video.videoHeight || 420;
              c.getContext('2d').drawImage(video, 0, 0);
              photoTaken = c.toDataURL('image/jpeg', 0.82);
            } catch (_) {}
          }
          const finalScore = Math.max(Math.round(score), photoTaken ? 55 : Math.round(score));
          const passed = finalScore >= 50;
          stage.onclick = null;
          const wrap = document.getElementById('live-photo-wrap');
          if (wrap && photoTaken) {
            wrap.innerHTML = '<img src="'+photoTaken+'" alt="Liveness" style="max-width:160px;border-radius:12px;border:2px solid #22c55e">' +
              '<p class="wiz-hint" style="color:#16a34a">Skor: '+finalScore+'% · foto disimpan</p>';
          }
          submitLiveness({
            passed, score: finalScore, frames: Math.round(elapsed/100),
            simulation: false, photo: photoTaken, challenges_passed: step
          });
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    document.getElementById('w-umkm-back')?.addEventListener('click', () => goWizPage('pic'));
    document.getElementById('w-umkm-cancel')?.addEventListener('click', () => cancelWizardEdits());
    document.getElementById('w-umkm-next').onclick = async () => {
      const scale = document.getElementById('w-scale').value;
      if (!scale) { toast('Pilih kategori', 'warn'); return; }
      const r0 = await fetch(API + '/set-scale', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          scale, phone: document.getElementById('w-phone').value,
          otp: document.getElementById('w-phone-otp').value || '123456',
          liveness: !!(m.liveness?.passed || st.liveness_ok)
        })
      });
      const j0 = await r0.json();
      if (!j0.success) { toast(j0.message||'Gagal set skala', 'error'); return; }
      const r = await fetch(API + '/wizard/umkm', { method: 'POST', headers: authHeaders(), body: '{}' });
      const j = await r.json();
      toast(j.message||'', j.success?'success':'error');
      if (j.success) { wizForcePage = null; await refreshMe(); loadRegFlow(); }
    };
  }

  function renderWizKuesioner(box, m) {
    snapshotWizard();
    const sc = (m.scale || 'mikro').toLowerCase();
    const defKar = sc === 'menengah' ? '100+' : (sc === 'kecil' ? '20-100' : '0-20');
    const defHarga = sc === 'menengah' ? '1000000+' : (sc === 'kecil' ? '50000-1000000' : '0-50000');
    const defOmset = sc === 'menengah' ? '450000000+' : (sc === 'kecil' ? '100000000-450000000' : '0-100000000');
    box.innerHTML = `
      <div class="wiz-page">
        <h3>Kuesioner Profil UMKM</h3>
        <p class="wiz-hint">Jawaban harus sesuai kategori <strong>${esc((m.scale||'').toUpperCase())}</strong>. Omset bulanan dihitung & dikunci sistem. Pilihan default sudah disesuaikan — pastikan cocok.</p>
        <label>Jumlah karyawan</label>
        <select class="wiz-select" id="kq-karyawan">
          <option value="0-20" ${defKar==='0-20'?'selected':''}>0 – 20 orang (Mikro)</option>
          <option value="20-100" ${defKar==='20-100'?'selected':''}>20 – 100 orang (Kecil)</option>
          <option value="100+" ${defKar==='100+'?'selected':''}>&gt; 100 orang (Menengah)</option>
        </select>
        <label>Kategori Usaha</label>
        <select class="wiz-select" id="kq-kat">
          <option>Dagang</option><option>Eceran</option><option>Jasa</option><option>Profesional</option><option>IRT</option><option>Lainnya</option>
        </select>
        <input id="kq-kat-lain" placeholder="Jika Lainnya, isi di sini" class="hidden" style="margin-top:6px">
        <label>Jenis Barang/Jasa</label>
        <select class="wiz-select" id="kq-jenis"><option>Barang</option><option>Jasa</option><option>Produk Digital</option></select>
        <label>Harga rata-rata Barang/Jasa</label>
        <select class="wiz-select" id="kq-harga">
          <option value="0-50000" ${defHarga==='0-50000'?'selected':''}>Rp 0 – 50.000 (Mikro)</option>
          <option value="50000-1000000" ${defHarga==='50000-1000000'?'selected':''}>Rp 50.000 – 1.000.000 (Kecil)</option>
          <option value="1000000+" ${defHarga==='1000000+'?'selected':''}>&gt; Rp 1.000.000 (Menengah)</option>
        </select>
        <label>Omset Harian</label>
        <select class="wiz-select" id="kq-omset">
          <option value="0-100000000" ${defOmset==='0-100000000'?'selected':''}>Rp 0 – 100.000.000 (Mikro)</option>
          <option value="100000000-450000000" ${defOmset==='100000000-450000000'?'selected':''}>Rp 100.000.000 – 450.000.000 (Kecil)</option>
          <option value="450000000+" ${defOmset==='450000000+'?'selected':''}>&gt; Rp 450.000.000 (Menengah)</option>
        </select>
        <p class="wiz-hint" id="kq-bulanan">Omset bulanan (terkunci): dihitung otomatis setelah simpan</p>
        <div class="wiz-actions">
          <button type="button" class="btn btn-outline" id="w-kq-back">← Kembali</button>
          <button type="button" class="btn btn-primary" id="w-kq-next">Simpan &amp; Lanjutkan → Persetujuan</button>
          ${canShowCancel(m) ? '<button type="button" class="btn btn-outline" id="w-kq-cancel">Batal</button>' : ''}
        </div>
      </div>`;
    document.getElementById('kq-kat').onchange = () => {
      document.getElementById('kq-kat-lain').classList.toggle('hidden', document.getElementById('kq-kat').value !== 'Lainnya');
    };
    document.getElementById('w-kq-next').onclick = async () => {
      const r = await fetch(API + '/kuesioner', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          karyawan_bucket: document.getElementById('kq-karyawan').value,
          kategori_usaha: document.getElementById('kq-kat').value,
          kategori_lainnya: document.getElementById('kq-kat-lain').value,
          jenis_barang_jasa: document.getElementById('kq-jenis').value,
          harga_bucket: document.getElementById('kq-harga').value,
          omset_bucket: document.getElementById('kq-omset').value
        })
      });
      const j = await r.json();
      if (j.success) {
        document.getElementById('kq-bulanan').textContent = 'Omset bulanan (terkunci): Rp ' + Number(j.data?.kuesioner?.omset_bulanan||0).toLocaleString('id-ID');
        toast(j.message, 'success');
        await refreshMe(); loadRegFlow();
      } else toast(j.message || 'Tidak lulus — sesuaikan dengan kategori', 'error');
    };
  }


    document.getElementById('w-kq-back')?.addEventListener('click', () => goWizPage('umkm'));
    document.getElementById('w-kq-cancel')?.addEventListener('click', () => cancelWizardEdits());
  function renderWizAgreements(box, m) {
    snapshotWizard();
    const keys = [
      { id: 'aml', title: 'Persetujuan Anti Money Laundry', check: 'AML disetujui' },
      { id: 'consumer', title: 'Persetujuan Perlindungan Konsumen', check: 'Perlindungan Konsumen disetujui' },
      { id: 'infosec', title: 'Persetujuan Keamanan Sistem Informasi', check: 'Keamanan SI disetujui' },
      { id: 'cyber', title: 'Persetujuan Keamanan Siber', check: 'Keamanan Siber disetujui' },
      { id: 'law', title: 'Persetujuan Taat Hukum & Pemblokiran Dana', check: 'Taat Hukum disetujui' }
    ];
    const done = (m.agreements || {});
    let openIdx = keys.findIndex(k => !done[k.id]);
    if (openIdx < 0) openIdx = keys.length;

    box.innerHTML = `
      <div class="wiz-page">
        <h3>Persetujuan Ketentuan</h3>
        <p class="wiz-hint">Baca isi setiap kartu, tekan <strong>Saya telah membaca dan menyetujui</strong>. Kartu berikutnya terbuka setelah setuju.</p>
        <div id="agree-stack"></div>
        <div class="wiz-actions" style="margin-top:16px">
          <button type="button" class="btn btn-outline" id="w-agree-back">← Kembali</button>
          <button type="button" class="btn btn-primary" id="w-agree-finish" ${openIdx < keys.length ? 'disabled' : ''}>Simpan &amp; Lanjutkan → Approval</button>
          ${canShowCancel(m) ? '<button type="button" class="btn btn-outline" id="w-agree-cancel">Batal</button>' : ''}
        </div>
      </div>`;

    const stack = document.getElementById('agree-stack');
    const defaults = {
      aml: 'PERSETUJUAN ANTI MONEY LAUNDERING (AML)\n\nSaya menyatakan dana berasal dari sumber sah, tidak terkait pencucian uang / pendanaan terorisme, sesuai UU No. 8 Tahun 2010 dan ketentuan PPATK. Transaksi mencurigakan dapat ditolak atau dilaporkan kepada otoritas berwenang.',
      consumer: 'PERSETUJUAN PERLINDUNGAN KONSUMEN\n\nSaya memahami hak & kewajiban sebagai pengguna layanan sesuai UU Perlindungan Konsumen, termasuk penanganan keluhan secara wajar melalui kanal resmi bdPay.',
      infosec: 'PERSETUJUAN KEAMANAN SISTEM INFORMASI\n\nSaya menjaga kredensial, tidak membagikan OTP/PIN, dan memahami risiko akses perangkat bersama. Saya bertanggung jawab atas aktivitas pada akun saya.',
      cyber: 'PERSETUJUAN KEAMANAN SIBER\n\nSaya tidak melakukan peretasan, penyalahgunaan API, atau aktivitas yang mengancam keamanan sistem bdPay. Pelanggaran dapat berujung pemblokiran akun.',
      law: 'PERSETUJUAN TAAT HUKUM & PEMBLOKIRAN DANA\n\nSaya tunduk pada hukum Republik Indonesia. Pengelola berhak menunda, menolak, atau memblokir dana/transaksi apabila terdapat perintah otoritas, indikasi fraud, pelanggaran AML, atau sengketa.'
    };

    async function loadTexts() {
      try {
        const r = await fetch('/api/public/config');
        const j = await r.json();
        const t = (j.data && j.data.tnc) || {};
        return {
          aml: t.aml || defaults.aml,
          consumer: t.consumer || defaults.consumer,
          infosec: t.infosec || defaults.infosec,
          cyber: t.cyber || defaults.cyber,
          law: t.law || defaults.law
        };
      } catch (_) { return defaults; }
    }

    loadTexts().then((texts) => {
      keys.forEach((k, i) => {
        const isDone = !!done[k.id];
        const isOpen = i === openIdx;
        const card = document.createElement('div');
        card.className = 'wiz-box';
        card.style.opacity = (isDone || isOpen) ? '1' : '0.45';
        card.style.pointerEvents = (isDone || isOpen) ? 'auto' : 'none';
        if (isOpen || isDone) {
          const scrollStyle = isDone
            ? 'max-height:140px;overflow:auto;font-size:.85rem;background:#e2e8f0;padding:12px;border-radius:10px;border:1px solid #cbd5e1;white-space:pre-wrap;line-height:1.5;margin-top:8px;opacity:.65;pointer-events:none;user-select:none;cursor:not-allowed'
            : 'max-height:140px;overflow:auto;font-size:.85rem;background:#f8fafc;padding:12px;border-radius:10px;border:1px solid #e2e8f0;white-space:pre-wrap;line-height:1.5;margin-top:8px';
          card.innerHTML =
            '<strong>' + (i + 1) + '. ' + k.title + (isDone ? ' ✓' : '') + '</strong>' +
            '<div class="agree-scroll" data-id="' + k.id + '" style="' + scrollStyle + '"' + (isDone ? ' aria-disabled="true"' : '') + '>' +
            (texts[k.id] || '') + '</div>' +
            '<button type="button" class="btn btn-outline btn-sm agree-read-btn" data-id="' + k.id + '" style="margin-top:10px" ' + (isDone ? 'disabled' : '') + '>Saya telah membaca dan menyetujui</button>' +
            '<label class="wiz-check">' +
            '<input type="checkbox" class="agree-check" data-id="' + k.id + '" ' + (isDone ? 'checked disabled' : 'disabled') + '>' +
            '<span>' + k.check + '</span></label>';
        } else {
          card.innerHTML = '<strong>' + (i + 1) + '. ' + k.title + '</strong><p class="wiz-hint">Terkunci — selesaikan kartu sebelumnya</p>';
        }
        stack.appendChild(card);
      });

      stack.querySelectorAll('.agree-read-btn').forEach(btn => {
        if (btn.disabled) return;
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          btn.disabled = true;
          const r = await fetch(API + '/agree', {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({ type: id })
          });
          const j = await r.json();
          if (!j.success) {
            toast(j.message || 'Gagal', 'error');
            btn.disabled = false;
            return;
          }
          toast(keys.find(x => x.id === id)?.check || 'Disetujui', 'success');
          const ck = stack.querySelector('.agree-check[data-id="' + id + '"]');
          if (ck) { ck.checked = true; ck.disabled = true; }
          const sc = stack.querySelector('.agree-scroll[data-id="' + id + '"]');
          if (sc) {
            sc.style.opacity = '0.65';
            sc.style.pointerEvents = 'none';
            sc.style.userSelect = 'none';
            sc.style.background = '#e2e8f0';
            sc.style.cursor = 'not-allowed';
            sc.setAttribute('aria-disabled', 'true');
          }
          btn.disabled = true;
          await refreshMe();
          loadRegFlow();
        });
      });
    });

    document.getElementById('w-agree-back')?.addEventListener('click', () => goWizPage('kuesioner'));
    document.getElementById('w-agree-cancel')?.addEventListener('click', () => cancelWizardEdits());
    document.getElementById('w-agree-finish')?.addEventListener('click', async () => {
      const r = await fetch(API + '/agree-pack', { method: 'POST', headers: authHeaders(), body: '{}' });
      const j = await r.json();
      if (!j.success) { toast(j.message || 'Gagal', 'error'); return; }
      wizForcePage = null;
      await finalizeReg();
    });
  }

  function renderWizDone(box, m) {
    const kyc = m.kyc || {};
    const geo = m.geo || {};
    const kq = m.kuesioner || {};
    const ag = m.agreements || {};
    const st = m.registration_steps || {};
    const live = m.liveness || {};
    let livePh = live.photo;
    if (!livePh) { try { livePh = sessionStorage.getItem('m_live_photo'); } catch (_) {} }
    const seg = (title, rows) => `<div class="card-seg"><h4>${title}</h4><table>${rows.map(([k,v]) => `<tr><th>${esc(k)}</th><td>${esc(v == null || v === '' ? '—' : v)}</td></tr>`).join('')}</table></div>`;
    const imgRow = (label, src) => {
      if (!src) return '';
      const safe = String(src).replace(/"/g, '');
      return `<div style="margin:8px 0;text-align:center"><div style="font-size:.8rem;color:#64748b">${label}</div>` +
        `<img src="${safe}" alt="${label}" style="max-width:180px;max-height:140px;border-radius:10px;border:1px solid #e2e8f0;object-fit:contain;background:#f8fafc" onerror="this.style.display='none';this.nextSibling&&(this.nextSibling.style.display='block')"/>` +
        `<div style="display:none;font-size:11px;color:#b91c1c">Gambar tidak tersedia</div></div>`;
    };
    box.innerHTML = `
      <div class="wiz-page">
        <h3 style="margin-top:0">Merchant Terverifikasi</h3>
        <p class="wiz-ok">Status: <strong>${esc(m.status)}</strong> · Skala: <strong>${esc(String(m.scale || '').toUpperCase())}</strong></p>
        <p class="wiz-hint">Kartu Registrasi Merchant — data tersimpan di Backend Admin (unduh PDF/cetak).</p>
        ${seg('1. Data PIC', [
          ['Nama PIC', m.pic_name], ['Email', m.email], ['Nama Dagang', m.trade_name],
          ['Telepon', m.phone], ['Website', m.website]
        ])}
        ${seg('2. KYC PIC', [
          ['NIK', kyc.nik], ['Nama sesuai KTP', kyc.nama_ktp], ['KYC', st.kyc_done ? 'Selesai' : '—']
        ])}
        <div class="card-seg"><h4>2b. Dokumen & Foto (cetak/unduh)</h4>
          <div style="display:flex;flex-wrap:wrap;gap:12px">
            ${imgRow('Foto KTP PIC', kyc.ktp_image || kyc.original_image)}
            ${imgRow('Foto KTP Hasil Rekayasa', kyc.ktp_processed || kyc.processed_image)}
            ${imgRow('Foto Liveness (skor ' + (live.score || 0) + '%)', livePh)}
            ${(function(){
              if (String(m.scale||'').toLowerCase() !== 'menengah') return '';
              const d = m.scale_docs || {};
              return imgRow('KTP Direksi', d.ktp_direksi && d.ktp_direksi.image)
                + imgRow('KTP Direksi Rekayasa', d.ktp_direksi && d.ktp_direksi.processed_image)
                + imgRow('NPWP', d.npwp_direksi && d.npwp_direksi.image)
                + imgRow('Akta Perusahaan', d.akta_notaris && d.akta_notaris.image)
                + imgRow('SK Kemenkumham', d.sk_kemenkumham && d.sk_kemenkumham.image);
            })()}
          </div>
        </div>
        ${seg('3. Lokasi GEO', [
          ['Kota/Kabupaten', geo.kota], ['Kecamatan', geo.kecamatan], ['Kode Pos', geo.kode_pos]
        ])}
        ${seg('4. UMKM & Kuesioner', [
          ['Skala', m.scale], ['Karyawan', kq.karyawan_bucket], ['Kategori usaha', kq.kategori_usaha],
          ['Jenis', kq.jenis_barang_jasa], ['Harga rata-rata', kq.harga_bucket],
          ['Omset harian', kq.omset_bucket], ['Omset bulanan', kq.omset_bulanan]
        ])}
        ${seg('5. Persetujuan', [
          ['AML', ag.aml ? 'Ya' : '—'], ['Perlindungan Konsumen', ag.consumer ? 'Ya' : '—'],
          ['Keamanan SI', ag.infosec ? 'Ya' : '—'], ['Keamanan Siber', ag.cyber ? 'Ya' : '—'],
          ['Taat Hukum', ag.law ? 'Ya' : '—']
        ])}
        <div class="wiz-actions">
          <button type="button" class="btn btn-outline" id="w-print-card">Cetak / PDF Kartu</button>
          <button type="button" class="btn btn-primary" id="w-edit-reg">Edit Ulang Registrasi</button>
        </div>
      </div>`;
    document.getElementById('w-print-card').onclick = () => {
      const w = window.open('', '_blank');
      w.document.write('<!DOCTYPE html><html><head><title>Kartu ' + esc(m.trade_name) + '</title><style>body{font-family:system-ui;padding:24px;max-width:720px;margin:auto}table{width:100%;border-collapse:collapse;margin-bottom:12px}th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:13px}th{background:#f1f5f9;width:32%}h2{font-size:1rem;border-bottom:2px solid #0ea5e9;padding-bottom:4px}@media print{button{display:none}}</style></head><body>');
      w.document.write('<button onclick="print()">Cetak / PDF</button><h1>Kartu Registrasi Merchant</h1>');
      w.document.write(box.querySelector('.wiz-page').innerHTML.replace(/<div class="wiz-actions"[\s\S]*?<\/div>/, ''));
      w.document.write('</body></html>');
      w.document.close();
    };
    document.getElementById('w-edit-reg').onclick = async () => {
      if (!(await inappConfirm('Ulangi registrasi hingga approval otomatis?'))) return;
      const r = await fetch(API + '/wizard/reset', { method: 'POST', headers: authHeaders(), body: '{}' });
      const j = await r.json();
      toast(j.message || '', j.success ? 'success' : 'error');
      if (j.success) {
        if (j.data) { merchant = j.data; sessionStorage.setItem('merchant_data', JSON.stringify(merchant)); }
        loadRegFlow();
      }
    };
  }


  async function finalizeReg() {
    const r = await fetch(API + '/finalize', { method: 'POST', headers: authHeaders(), body: '{}' });
    const j = await r.json();
    toast(j.message || '', j.success ? 'success' : 'error');
    await refreshMe();
    loadRegFlow();
    loadDashboard();
  }


  function bulkUI(title, type) {
    return `
      <h3 style="margin-top:0">${title}</h3>
      <div class="form-group"><label>Bank / Kode</label>
        <select id="bx-bank">${bankOptionsHtml('bni')}</select>
      </div>
      <div class="form-group"><label>No. Rekening</label><input id="bx-rek" placeholder="Nomor rekening"></div>
      <div class="form-group"><label>Nama Penerima</label><input id="bx-nama" placeholder="Nama"></div>
      <div class="form-group"><label>Nominal (Rp)</label><input id="bx-amt" inputmode="numeric" placeholder="100.000"></div>
      <button type="button" class="btn btn-primary" id="bx-add">+ Tambah ke Draft</button>
      <hr>
      <div class="form-group"><label>Upload Excel/CSV (max 10 baris: bank,rek,nama,nominal)</label>
        <input type="file" id="bx-file" accept=".csv,.txt,.xlsx">
        <button type="button" class="btn btn-outline btn-sm" id="bx-tpl" style="margin-top:6px">Unduh Template CSV</button>
      </div>
      <div id="bx-draft"></div>
      <button type="button" class="btn btn-primary" id="bx-submit">Proses Draft</button>
      <div id="bx-result"></div>
    `;
  }

  let draft = [];


  async function loadInvoice() {
    const box = document.getElementById('m-invoice-box');
    if (!box) return;
    let lines = [{ name: '', qty_type: 'unit', qty: 1, unit_price: 0 }];
    function lineTotal(it) {
      const q = it.qty_type === 'ls' ? 1 : Math.max(1, Number(it.qty) || 1);
      const u = Number(String(it.unit_price).toString().replace(/\D/g, '')) || 0;
      return it.qty_type === 'ls' ? u : u * q;
    }
    function renderForm() {
      const rows = lines.map((it, i) => `
        <tr>
          <td>${i + 1}</td>
          <td><input data-i="${i}" data-f="name" value="${esc(it.name)}" placeholder="Produk/jasa" style="width:100%;padding:6px;border-radius:8px;border:1px solid #e2e8f0"></td>
          <td><select data-i="${i}" data-f="qty_type" style="padding:6px;border-radius:8px;border:1px solid #e2e8f0">
            <option value="unit" ${it.qty_type!=='ls'?'selected':''}>Unit</option>
            <option value="ls" ${it.qty_type==='ls'?'selected':''}>Lumpsum (ls)</option>
          </select></td>
          <td><input data-i="${i}" data-f="qty" type="number" min="1" value="${it.qty_type==='ls'?1:(it.qty||1)}" ${it.qty_type==='ls'?'disabled':''} style="width:70px;padding:6px;border-radius:8px;border:1px solid #e2e8f0"></td>
          <td><input data-i="${i}" data-f="unit_price" value="${Number(it.unit_price||0).toLocaleString('id-ID')}" style="width:110px;padding:6px;border-radius:8px;border:1px solid #e2e8f0"></td>
          <td style="text-align:right;font-weight:600;min-width:90px">Rp ${lineTotal(it).toLocaleString('id-ID')}</td>
          <td style="padding-left:16px;white-space:nowrap"><button type="button" class="btn btn-outline btn-sm inv-del-btn" data-del="${i}" ${lines.length<=1?'disabled':''} title="Hapus baris" style="min-width:36px;margin-left:8px">✕</button></td>
        </tr>`).join('');
      const totalQty = lines.reduce((a, it) => a + (it.qty_type === 'ls' ? 1 : Math.max(1, Number(it.qty) || 1)), 0);
      const totalAmt = lines.reduce((a, it) => a + lineTotal(it), 0);
      box.innerHTML = `
      <div class="invoice-sheet" style="border:1px solid #e2e8f0;border-radius:16px;padding:16px;background:#fff">
        <div style="display:flex;justify-content:space-between;margin-bottom:12px">
          <strong style="font-size:1.15rem">Invoice</strong><span style="color:#64748b">bdPay Merchant · max 10 baris</span>
        </div>
        <div class="m-form-grid">
          <div class="form-group"><label>Nama Pelanggan <span class="req">*</span></label><input id="inv-cust" placeholder="Nama pelanggan"></div>
          <div class="form-group"><label>Email</label><input id="inv-email" type="email"></div>
          <div class="form-group"><label>Telepon</label><input id="inv-phone"></div>
          <div class="form-group"><label>Bank VA Preferred</label><select id="inv-bank">${bankOptionsHtml('bni')}</select></div>
        </div>
        <div style="overflow:auto;margin-top:12px">
          <table style="width:100%;font-size:.85rem;border-collapse:collapse">
            <thead><tr style="background:#f8fafc"><th>#</th><th>Produk/Jasa</th><th>Qty Type</th><th>Qty</th><th>Harga Satuan</th><th>Harga</th><th></th></tr></thead>
            <tbody id="inv-lines">${rows}</tbody>
            <tfoot>
              <tr style="background:#ecfdf5;font-weight:700">
                <td colspan="3">Total</td>
                <td>${totalQty}</td>
                <td></td>
                <td style="text-align:right">Rp ${totalAmt.toLocaleString('id-ID')}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div class="wiz-actions" style="margin-top:12px">
          <button type="button" class="btn btn-outline" id="inv-add-line" ${lines.length>=10?'disabled':''}>+ Baris</button>
          <button type="button" class="btn btn-primary" id="inv-issue">Terbitkan Invoice + VA</button>
        </div>
        <div id="inv-result" style="margin-top:12px"></div>
      </div>
      <div style="margin:18px 0 0;padding-top:16px;border-top:1px solid #e2e8f0"><h3 style="margin:0 0 10px">Daftar Invoice</h3><div id="inv-list">Memuat…</div>`;
      box.querySelectorAll('[data-f]').forEach(inp => {
        const apply = (full) => {
          const i = Number(inp.dataset.i);
          const f = inp.dataset.f;
          if (f === 'unit_price') {
            const raw = String(inp.value).replace(/\D/g, '');
            lines[i][f] = Number(raw) || 0;
            // format currency without moving cursor to start
            const formatted = lines[i][f] ? lines[i][f].toLocaleString('id-ID') : '';
            if (document.activeElement === inp) {
              const pos = inp.selectionStart;
              const before = inp.value.length;
              inp.value = formatted;
              const delta = inp.value.length - before;
              try { inp.setSelectionRange(Math.max(0, pos + delta), Math.max(0, pos + delta)); } catch (_) {}
            } else {
              inp.value = formatted;
            }
          } else if (f === 'qty') {
            lines[i][f] = Math.max(1, Number(inp.value) || 1);
          } else if (f === 'qty_type') {
            lines[i][f] = inp.value;
            renderForm();
            return;
          } else {
            // name / text: update model only, DO NOT re-render (cursor stays)
            lines[i][f] = inp.value;
          }
          // update totals row live without destroying inputs
          const totalQty = lines.reduce((a, it) => a + (it.qty_type === 'ls' ? 1 : Math.max(1, Number(it.qty) || 1)), 0);
          const totalAmt = lines.reduce((a, it) => a + lineTotal(it), 0);
          const tfoot = box.querySelector('tfoot tr');
          if (tfoot) {
            tfoot.innerHTML = '<td colspan="3">Total</td><td>' + totalQty + '</td><td></td><td style="text-align:right">Rp ' + totalAmt.toLocaleString('id-ID') + '</td><td></td>';
          }
          // update line total cell
          const tr = inp.closest('tr');
          if (tr) {
            const cells = tr.querySelectorAll('td');
            if (cells[5]) cells[5].textContent = 'Rp ' + lineTotal(lines[Number(inp.dataset.i)]).toLocaleString('id-ID');
          }
        };
        inp.addEventListener('input', () => apply(false));
        inp.addEventListener('change', () => apply(true));
      });
      box.querySelectorAll('[data-del]').forEach(btn => {
        btn.onclick = () => { lines.splice(Number(btn.dataset.del), 1); if (!lines.length) lines.push({ name: '', qty_type: 'unit', qty: 1, unit_price: 0 }); renderForm(); };
      });
      document.getElementById('inv-add-line').onclick = () => {
        if (lines.length >= 10) return;
        lines.push({ name: '', qty_type: 'unit', qty: 1, unit_price: 0 });
        renderForm();
      };
      document.getElementById('inv-issue').onclick = async () => {
        const customer_name = document.getElementById('inv-cust').value.trim();
        if (!customer_name) { toast('Nama pelanggan wajib', 'warn'); return; }
        const items = lines.map(it => ({
          name: it.name || 'Item',
          qty_type: it.qty_type,
          qty: it.qty,
          unit_price: Number(String(it.unit_price).toString().replace(/\D/g,'')) || 0
        })).filter(it => it.unit_price > 0);
        if (!items.length) { toast('Isi minimal 1 baris dengan harga', 'warn'); return; }
        const r = await fetch(API + '/invoices', {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({
            customer_name,
            customer_email: document.getElementById('inv-email').value.trim(),
            customer_phone: document.getElementById('inv-phone').value.trim(),
            va_bank: document.getElementById('inv-bank').value,
            items
          })
        });
        const j = await r.json();
        toast(j.message || '', j.success ? 'success' : 'error');
        if (j.success && j.data) {
          showInvResult(j.data);
          refreshList();
        }
      };
      refreshList();
    }
    function showInvResult(d) {
      const itemsHtml = (d.items || []).map(it =>
        `<tr><td>${esc(it.name)}</td><td>${it.qty_type==='ls'?'ls':it.qty}</td><td>Rp ${Number(it.unit_price).toLocaleString('id-ID')}</td><td>Rp ${Number(it.line_total).toLocaleString('id-ID')}</td></tr>`
      ).join('');
      document.getElementById('inv-result').innerHTML =
        `<div class="alert alert-success" id="inv-print-area">
          <strong>Invoice ${esc(d.invoice_no)}</strong><br>
          Pelanggan: ${esc(d.customer_name)}<br>
          <table style="width:100%;margin:8px 0;font-size:.85rem"><thead><tr><th>Item</th><th>Qty</th><th>Satuan</th><th>Total</th></tr></thead><tbody>${itemsHtml}</tbody>
          <tfoot><tr><th colspan="3">Total Qty ${d.total_qty||''}</th><th>Rp ${Number(d.amount).toLocaleString('id-ID')}</th></tr></tfoot></table>
          VA: <code style="font-size:1.1rem">${esc(d.va_number)}</code> (${esc(d.va_bank)}) · berlaku 1 hari s/d ${esc((d.expires_at||'').replace('T',' ').slice(0,19))}<br>
          Status: <b>${esc(d.status)}</b>
          <div style="margin-top:8px"><button type="button" class="btn btn-outline btn-sm" id="inv-pdf">Unduh / Cetak PDF</button></div>
        </div>`;
      document.getElementById('inv-pdf').onclick = () => {
        const w = window.open('', '_blank');
        w.document.write('<!DOCTYPE html><html><head><title>Invoice '+esc(d.invoice_no)+'</title><style>body{font-family:system-ui;padding:24px;max-width:720px;margin:auto}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:8px;text-align:left}@media print{button{display:none}}</style></head><body>');
        var _html = document.getElementById('inv-print-area').innerHTML;
        w.document.write(_html.replace(/<button[\s\S]*?<\/button>/g, ''));
        w.document.write('<script>setTimeout(function(){window.print()},300)</script></body></html>');
        w.document.close();
      };
    }
    async function refreshList() {
      const r = await fetch(API + '/invoices', { headers: authHeaders() });
      const j = await r.json();
      const el = document.getElementById('inv-list');
      if (!el) return;
      const rows = j.data || [];
      if (!rows.length) { el.innerHTML = '<p class="wiz-hint">Belum ada invoice.</p>'; return; }
      el.innerHTML = '<table class="m-table"><thead><tr><th>No</th><th>Pelanggan</th><th>Items</th><th>Total</th><th>VA</th><th>Status</th><th></th></tr></thead><tbody>' +
        rows.map(inv => `<tr>
          <td>${esc(inv.invoice_no)}</td><td>${esc(inv.customer_name)}</td>
          <td>${(inv.items||[]).length}</td>
          <td>Rp ${Number(inv.amount||0).toLocaleString('id-ID')}</td>
          <td><code>${esc(inv.va_number)}</code></td>
          <td>${esc(inv.status)}</td>
          <td><button type="button" class="btn btn-outline btn-sm" data-inv-check="${esc(inv.id)}">Cek</button>
          <button type="button" class="btn btn-outline btn-sm" data-inv-pdf='${JSON.stringify(inv).replace(/'/g,"&#39;")}'>PDF</button></td>
        </tr>`).join('') + '</tbody></table>';
      el.querySelectorAll('[data-inv-check]').forEach(btn => {
        btn.onclick = async () => {
          const r2 = await fetch(API + '/invoices/' + btn.dataset.invCheck + '/check', { method: 'POST', headers: authHeaders(), body: '{}' });
          const j2 = await r2.json();
          toast(j2.message || '', j2.success ? 'success' : 'error');
          refreshList();
        };
      });
      el.querySelectorAll('[data-inv-pdf]').forEach(btn => {
        btn.onclick = () => {
          try { showInvResult(JSON.parse(btn.getAttribute('data-inv-pdf'))); } catch(_) {}
        };
      });
    }
    renderForm();
  }


  async function loadRemittance() {
    const box = document.getElementById('m-remittance-box');
    if (!box) return;
    box.innerHTML = `
      <p class="wiz-hint">Transfer dana internasional. Stage layanan mengikuti pengaturan Backend Admin.</p>
      <div class="m-form-grid">
        <div class="form-group"><label>Provider</label>
          <select id="rmt-prov">
            <option value="ria">Ria Money Transfer</option>
            <option value="moneygram">MoneyGram</option>
            <option value="westernunion">Western Union</option>
          </select>
        </div>
        <div class="form-group"><label>Nominal (Rp) <span class="req">*</span></label><input id="rmt-amt" value="1.000.000"></div>
        <div class="form-group"><label>Negara Tujuan</label>
          <select id="rmt-country">
            <option value="US">United States</option>
            <option value="PH">Philippines</option>
            <option value="MY">Malaysia</option>
            <option value="SG">Singapore</option>
            <option value="AU">Australia</option>
          </select>
        </div>
        <div class="form-group"><label>Mata Uang Tujuan</label>
          <select id="rmt-ccy"><option>USD</option><option>PHP</option><option>MYR</option><option>SGD</option></select>
        </div>
        <div class="form-group"><label>Nama Penerima</label><input id="rmt-bene" placeholder="Beneficiary name"></div>
        <div class="form-group"><label>Bank VA Preferred</label><select id="rmt-bank">${bankOptionsHtml('bni')}</select></div>
      </div>
      <div id="rmt-quote" class="wiz-hint">Tekan Quote untuk melihat konversi</div>
      <div class="wiz-actions">
        <button type="button" class="btn btn-outline" id="rmt-quote-btn">Quote Konversi</button>
        <button type="button" class="btn btn-primary" id="rmt-go">Proses Transfer (Terbit VA)</button>
      </div>
      <div id="rmt-out"></div>
      <div style="margin:18px 0 0;padding-top:16px;border-top:1px solid #e2e8f0"><h3 style="margin:0 0 10px">Status Remittance</h3><div id="rmt-list">Memuat…</div></div>`;
    wireCurrency('rmt-amt');
    async function refreshRmt() {
      try {
        const r = await fetch(API + '/remittance', { headers: authHeaders() });
        const j = await r.json();
        const el = document.getElementById('rmt-list');
        if (!el) return;
        const rows = j.data || [];
        el.innerHTML = rows.length ? '<table class="m-table"><thead><tr><th>ID</th><th>Provider</th><th>IDR</th><th>VA</th><th>Status</th><th></th></tr></thead><tbody>' +
          rows.map(t => '<tr><td>' + esc(t.id) + '</td><td>' + esc(t.provider) + '</td><td>Rp ' + Number(t.amount_idr||0).toLocaleString('id-ID') + '</td>' +
            '<td><code>' + esc(t.va_number) + '</code></td><td>' + esc(t.status) + '</td>' +
            '<td><button type="button" class="btn btn-outline btn-sm" data-rmt="' + esc(t.id) + '">Cek Status</button></td></tr>').join('') + '</tbody></table>'
          : '<p class="wiz-hint">Belum ada transaksi remittance</p>';
        el.querySelectorAll('[data-rmt]').forEach(btn => {
          btn.onclick = async () => {
            const r2 = await fetch(API + '/remittance/' + btn.dataset.rmt + '/status', { method: 'POST', headers: authHeaders(), body: '{}' });
            const j2 = await r2.json();
            toast((j2.data && j2.data.status) || j2.message || '', j2.success ? 'success' : 'error');
            refreshRmt();
          };
        });
      } catch (e) {
        const el = document.getElementById('rmt-list');
        if (el) el.innerHTML = '<p class="wiz-hint" style="color:#dc2626">Gagal muat: ' + esc(e.message) + '</p>';
      }
    }
    document.getElementById('rmt-quote-btn').onclick = async () => {
      const amount_idr = parseCurrency(document.getElementById('rmt-amt').value);
      try {
        const r = await fetch(API + '/remittance/quote', {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({
            provider: document.getElementById('rmt-prov').value,
            amount_idr,
            dest_country: document.getElementById('rmt-country').value,
            dest_currency: document.getElementById('rmt-ccy').value
          })
        });
        const j = await r.json();
        if (!j.success) { toast(j.message || 'Gagal', 'error'); return; }
        const d = j.data || {};
        document.getElementById('rmt-quote').innerHTML =
          '<div class="alert alert-success">Kurs ≈ <b>' + (d.fx_rate || '-') + '</b> · Terima ≈ <b>' + (d.receive_amount || '-') + ' ' + (d.dest_currency||'') + '</b> · Fee ~USD ' + (d.fee_usd||'-') +
          ' · Limit USD ' + (d.limit_usd||10000) + ' · ETA ' + esc(d.eta||'') + '</div>';
      } catch (e) { toast(e.message || 'Gagal quote', 'error'); }
    };
    document.getElementById('rmt-go').onclick = async () => {
      const amount_idr = parseCurrency(document.getElementById('rmt-amt').value);
      try {
        const r = await fetch(API + '/remittance/create', {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({
            provider: document.getElementById('rmt-prov').value,
            amount_idr,
            dest_country: document.getElementById('rmt-country').value,
            dest_currency: document.getElementById('rmt-ccy').value,
            beneficiary_name: document.getElementById('rmt-bene').value.trim(),
            va_bank: document.getElementById('rmt-bank').value
          })
        });
        const j = await r.json();
        toast(j.message || '', j.success ? 'success' : 'error');
        if (j.success && j.data) {
          const d = j.data;
          document.getElementById('rmt-out').innerHTML =
            '<div class="alert alert-success">VA: <code style="font-size:1.1rem">' + esc(d.va_number) + '</code> · Bayar Rp ' +
            Number(d.amount_idr).toLocaleString('id-ID') + ' · Status: ' + esc(d.status) + '</div>';
          refreshRmt();
        }
      } catch (e) { toast(e.message || 'Gagal', 'error'); }
    };
    refreshRmt();
  }

  async function loadTransfer() {
    const box = document.getElementById('m-transfer-box');
    if (!box) return;
    box.innerHTML = `
      <div class="m-form-grid">
        <div class="form-group"><label>Bank <span class="req">*</span></label>
          <select id="tr-bank">${bankOptionsHtml('bni')}</select>
        </div>
        <div class="form-group"><label>Nomor Rekening <span class="req">*</span></label><input id="tr-rek" placeholder="Nomor rekening tujuan" maxlength="20" required></div>
        <div class="form-group"><label>Nama Penerima</label><input id="tr-nama" readonly placeholder="Hasil inquiry"></div>
        <div class="form-group"><label>Nominal (Rp) <span class="req">*</span></label><input id="tr-amt" value="100.000" required></div>
      </div>
      <div class="wiz-actions">
        <button type="button" class="btn btn-outline" id="tr-inq">Inquiry Nama</button>
        <button type="button" class="btn btn-primary" id="tr-va">Terbitkan Virtual Account</button>
      </div>
      <hr style="margin:18px 0;border:none;border-top:1px solid #e2e8f0">
      <h3 style="margin:0 0 8px;font-size:1rem">Cek Status Transfer</h3>
      <div class="m-form-grid">
        <div class="form-group"><label>Nomor Order</label><input id="tr-order" placeholder="MTR-…"></div>
      </div>
      <button type="button" class="btn btn-outline" id="tr-status" style="margin-top:8px">Cek Status</button>
      <div id="tr-out"></div>`;
    wireCurrency('tr-amt');
    document.getElementById('tr-inq').onclick = async () => {
      if (!requireFields([['tr-rek', 'Nomor rekening']])) return;
      const r = await fetch(API + '/inquiry-account', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ bank: document.getElementById('tr-bank').value, account: document.getElementById('tr-rek').value.trim() })
      });
      const j = await r.json();
      if (j.success) {
        document.getElementById('tr-nama').value = j.data.name || j.data.account_name || '';
        toast('Inquiry berhasil', 'success');
      } else toast(j.message || 'Inquiry gagal', 'error');
    };
    document.getElementById('tr-va').onclick = async () => {
      if (!requireFields([['tr-rek', 'Nomor rekening'], ['tr-nama', 'Nama penerima (inquiry dulu)'], ['tr-amt', 'Nominal']])) return;
      const amount = parseCurrency(document.getElementById('tr-amt').value);
      if (amount < 10000) return toast('Nominal minimal Rp 10.000', 'warn');
      const r = await fetch(API + '/transfer-bulk', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          items: [{
            bank: document.getElementById('tr-bank').value,
            account: document.getElementById('tr-rek').value.trim(),
            name: document.getElementById('tr-nama').value.trim(),
            amount
          }]
        })
      });
      const j = await r.json();
      const out = document.getElementById('tr-out');
      if (!j.success) {
        out.innerHTML = '<p style="color:#b91c1c">' + esc(j.message) + '</p>';
        return toast(j.message || 'Gagal', 'error');
      }
      const row = (j.data && j.data[0]) || j.data || {};
      out.innerHTML = renderVAResult(row, 'Transfer Request');
      toast('Virtual Account diterbitkan', 'success');
    };
    document.getElementById('tr-status').onclick = async () => {
      const order = document.getElementById('tr-order').value.trim();
      if (!order) return toast('Nomor Order wajib', 'warn');
      const r = await fetch(API + '/transactions', { headers: authHeaders() });
      const j = await r.json();
      const t = (j.data || []).find(x => x.order_no === order || x.ref_id === order);
      const out = document.getElementById('tr-out');
      if (!t) {
        out.innerHTML = '<p style="color:#b91c1c">Order tidak ditemukan</p>';
        return toast('Tidak ditemukan', 'error');
      }
      out.innerHTML = `<div class="receipt"><h3>Status Order</h3>
        <table>
          <tr><th>Nomor Order</th><td><code>${esc(t.order_no || t.ref_id)}</code></td></tr>
          <tr><th>VA</th><td>${esc(t.va_number || '—')}</td></tr>
          <tr><th>Nominal</th><td>${fmtRp(t.amount)}</td></tr>
          <tr><th>Status</th><td><strong>${esc(t.status)}</strong></td></tr>
          <tr><th>Tanggal</th><td>${esc((t.created_at || '').slice(0, 19).replace('T', ' '))}</td></tr>
        </table></div>`;
      toast('Status: ' + t.status, 'info');
    };
  }

  function renderVAResult(row, title) {
    const d = row || {};
    const va = d.va_number || '';
    const ord = d.order_no || d.ref_id || '';
    const isQris = (d.payment_method === 'qris' || d.qr_string) && !va;
    const qrPayload = d.qr_string || (va ? ('VA:' + va + '|ORD:' + ord) : (d.receipt_url ? (location.origin + d.receipt_url) : ord));
    const qrImg = 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent(qrPayload);
    let head = '';
    if (isQris || d.qr_string) {
      head = '<div style="text-align:center;margin:10px 0"><img src="' + qrImg + '" alt="QRIS" width="180" height="180" style="border-radius:12px;border:1px solid #e2e8f0"/><p class="wiz-hint">Scan QRIS</p></div>';
    } else if (va) {
      head = '<div class="va-big">' + esc(va) + '</div>' +
        '<div style="text-align:center;margin:8px 0"><img src="' + qrImg + '" alt="QR VA" width="140" height="140" style="border-radius:10px;border:1px solid #e2e8f0"/><p class="wiz-hint">QR / URL Struk</p></div>';
    }
    const receiptUrl = d.receipt_url || ('/api/merchant/receipt/' + (d.id || ''));
    const publicUrl = (receiptUrl.startsWith('http') ? receiptUrl : (location.origin + receiptUrl));
    if (head.indexOf('api.qrserver') >= 0) {
      head += '<p style="text-align:center;font-size:11px;word-break:break-all;margin:4px 0 10px"><a href="' + publicUrl + '" target="_blank" rel="noopener">' + esc(publicUrl) + '</a></p>';
    }
    return '<div class="receipt"><h3>' + esc(title || 'Struk') + '</h3>' + head +
      '<table>' +
      (ord ? '<tr><th>Nomor Order</th><td><code>' + esc(ord) + '</code></td></tr>' : '') +
      (d.bank ? '<tr><th>Bank Penerima</th><td>' + esc(d.bank) + '</td></tr>' : '') +
      (d.account ? '<tr><th>Nomor Rekening</th><td>' + esc(d.account) + '</td></tr>' : '') +
      (d.name ? '<tr><th>Nama Penerima</th><td>' + esc(d.name) + '</td></tr>' : '') +
      '<tr><th>Nominal</th><td>' + fmtRp(d.amount != null ? d.amount : 0) + '</td></tr>' +
      (d.fee_lines || []).map(function (l) { return '<tr><th>' + esc(l.name || 'Biaya Layanan') + '</th><td>' + fmtRp(l.amount) + '</td></tr>'; }).join('') +
      (d.tax_lines || []).map(function (l) { return '<tr><th>' + esc(l.name || 'Pajak') + '</th><td>' + fmtRp(l.amount) + '</td></tr>'; }).join('') +
      ((!(d.fee_lines && d.fee_lines.length) && d.fee) ? '<tr><th>Biaya Layanan</th><td>' + fmtRp(d.fee) + '</td></tr>' : '') +
      ((!(d.tax_lines && d.tax_lines.length) && d.tax) ? '<tr><th>Pajak</th><td>' + fmtRp(d.tax) + '</td></tr>' : '') +
      '<tr><th>Total Bayar</th><td><strong>' + fmtRp(d.grand_total != null ? d.grand_total : ((Number(d.amount)||0) + (Number(d.fee)||0) + (Number(d.tax)||0))) + '</strong></td></tr>' +
      (d.invoice_no ? '<tr><th>Nomor Invoice</th><td>' + esc(d.invoice_no) + '</td></tr>' : '') +
      (d.po_no ? '<tr><th>Nomor PO</th><td>' + esc(d.po_no) + '</td></tr>' : '') +
      (d.qo_no ? '<tr><th>Nomor QO</th><td>' + esc(d.qo_no) + '</td></tr>' : '') +
      (d.sales_no ? '<tr><th>Nomor Sales</th><td>' + esc(d.sales_no) + '</td></tr>' : '') +
      (d.ref_no ? '<tr><th>Nomor Referensi</th><td>' + esc(d.ref_no) + '</td></tr>' : '') +
      (d.status ? '<tr><th>Status</th><td>' + esc(d.status) + '</td></tr>' : '') +
      '</table>' +
      '<div class="guide-box"><strong>Panduan Mobile Banking / ATM</strong><ol style="margin:6px 0 0;padding-left:18px">' +
      '<li>Transfer ke Virtual Account / scan QR di atas.</li><li>Pastikan nominal sesuai struk.</li><li>Simpan bukti; unduh PDF struk jika perlu.</li></ol></div>' +
      '<div class="wiz-actions" style="flex-wrap:wrap;gap:8px">' +
      (va ? '<button type="button" class="btn btn-outline btn-sm" onclick="navigator.clipboard.writeText(\'' + esc(va) + '\');if(window.toast)toast(\'VA disalin\',\'success\')">Salin VA</button>' : '') +
      (ord ? '<button type="button" class="btn btn-outline btn-sm" onclick="navigator.clipboard.writeText(\'' + esc(ord) + '\');if(window.toast)toast(\'Order disalin\',\'success\')">Salin Order</button>' : '') +
      (isQris || d.qr_string ? '<a class="btn btn-outline btn-sm" href="' + qrImg + '" download="qris-bdpay.png">Unduh QR</a>' : '') +
      '<a class="btn btn-primary btn-sm" href="' + receiptUrl + '" target="_blank" rel="noopener">Unduh / Cetak PDF</a>' +
      '</div></div>';
  }

  async function loadVendor() {
    const box = document.getElementById('m-vendor-box');
    if (!box) return;
    box.innerHTML = `
      <div class="m-form-grid">
        <div class="form-group"><label>Bank Penerima <span class="req">*</span></label>
          <select id="vd-bank">${bankOptionsHtml('bni')}</select>
        </div>
        <div class="form-group"><label>Nomor Rekening Penerima <span class="req">*</span></label><input id="vd-rek" maxlength="20"></div>
        <div class="form-group"><label>Nama Penerima</label><input id="vd-nama" readonly placeholder="Hasil inquiry"></div>
        <div class="form-group"><label>Nominal (Rp) <span class="req">*</span></label><input id="vd-amt" value="100.000"></div>
        <div class="form-group"><label>Nomor Invoice <span class="req">*</span></label><input id="vd-inv" placeholder="INV-…"></div>
        <div class="form-group"><label>Nomor PO</label><input id="vd-po" placeholder="PO-…"></div>
        <div class="form-group"><label>Nomor QO</label><input id="vd-qo" placeholder="QO-…"></div>
        <div class="form-group"><label>Nomor Sales</label><input id="vd-sales" placeholder="SO-…"></div>
        <div class="form-group"><label>Nomor Referensi <span class="req">*</span></label><input id="vd-ref" placeholder="REF-…"></div>
      </div>
      <div class="wiz-actions">
        <button type="button" class="btn btn-outline" id="vd-inq">Inquiry Nama Penerima</button>
        <button type="button" class="btn btn-primary" id="vd-va">Terbitkan Virtual Account</button>
      </div>
      <div id="vd-out"></div>`;
    wireCurrency('vd-amt');
    document.getElementById('vd-inq').onclick = async () => {
      if (!requireFields([['vd-rek', 'Nomor rekening']])) return;
      const r = await fetch(API + '/inquiry-account', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ bank: document.getElementById('vd-bank').value, account: document.getElementById('vd-rek').value.trim() })
      });
      const j = await r.json();
      if (j.success) {
        document.getElementById('vd-nama').value = j.data.name || '';
        toast('Inquiry berhasil', 'success');
      } else toast(j.message || 'Gagal', 'error');
    };
    document.getElementById('vd-va').onclick = async () => {
      if (!requireFields([
        ['vd-rek', 'Nomor rekening'], ['vd-nama', 'Nama penerima'], ['vd-amt', 'Nominal'],
        ['vd-inv', 'Nomor Invoice'], ['vd-ref', 'Nomor Referensi']
      ])) return;
      const amount = parseCurrency(document.getElementById('vd-amt').value);
      if (amount < 10000) return toast('Nominal minimal Rp 10.000', 'warn');
      const payload = {
        bank: document.getElementById('vd-bank').value,
        account: document.getElementById('vd-rek').value.trim(),
        name: document.getElementById('vd-nama').value.trim(),
        amount,
        invoice_no: document.getElementById('vd-inv').value.trim(),
        po_no: document.getElementById('vd-po').value.trim(),
        qo_no: document.getElementById('vd-qo').value.trim(),
        sales_no: document.getElementById('vd-sales').value.trim(),
        reference_no: document.getElementById('vd-ref').value.trim()
      };
      const r = await fetch(API + '/vendor-pay', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ items: [payload] })
      });
      const j = await r.json();
      const out = document.getElementById('vd-out');
      if (!j.success) {
        out.innerHTML = '<p style="color:#b91c1c">' + esc(j.message) + '</p>';
        return toast(j.message || 'Gagal', 'error');
      }
      const row = (j.data && j.data[0]) || {};
      const receiptUrl = row.receipt_url || ('/api/merchant/receipt/' + encodeURIComponent(row.id || ''));
      out.innerHTML = `
        <div class="receipt" id="vd-receipt">
          <h3>Struk Bukti Bayar — Virtual Account</h3>
          <div class="va-big">${esc(row.va_number)}</div>
          <table>
            <tr><th>Bank Penerima <span class="req">*</span></th><td>${esc(row.bank)}</td></tr>
            <tr><th>Nomor Rekening Penerima <span class="req">*</span></th><td>${esc(row.account)}</td></tr>
            <tr><th>Nama Penerima</th><td>${esc(row.name)}</td></tr>
            <tr><th>Nominal</th><td>${fmtRp(row.amount)}</td></tr>
            <tr><th>Nomor Invoice <span class="req">*</span></th><td>${esc(row.invoice_no)}</td></tr>
            <tr><th>Nomor PO</th><td>${esc(row.po_no || '—')}</td></tr>
            <tr><th>Nomor QO</th><td>${esc(row.qo_no || '—')}</td></tr>
            <tr><th>Nomor Sales</th><td>${esc(row.sales_no || '—')}</td></tr>
            <tr><th>Nomor Referensi <span class="req">*</span></th><td>${esc(row.reference_no)}</td></tr>
            <tr><th>Nomor Order</th><td><code>${esc(row.order_no)}</code></td></tr>
            <tr><th>QR / URL Struk Publik</th><td><a href="${esc(receiptUrl)}" target="_blank">${esc(receiptUrl)}</a></td></tr>
          </table>
          <div class="guide-box">
            <strong>Panduan Mobile Banking / ATM</strong>
            <ol style="margin:6px 0 0;padding-left:18px">
              <li>Transfer ke Virtual Account di atas.</li>
              <li>Pastikan nominal sesuai struk.</li>
              <li>Simpan bukti; unduh PDF struk jika perlu.</li>
            </ol>
          </div>
          <div class="wiz-actions">
            <a class="btn btn-primary btn-sm" href="${esc(receiptUrl)}?print=1" target="_blank">Unduh / Cetak PDF</a>
            <button type="button" class="btn btn-outline btn-sm" id="vd-copy-va">Salin VA</button>
          </div>
        </div>`;
      const _vdc = document.getElementById('vd-copy-va') || document.getElementById('vd-copy');
      if (_vdc) _vdc.onclick = () => {
        navigator.clipboard.writeText(row.va_number || '');
        toast('VA disalin', 'success');
      };
      // Salin Order button if present
      let ordBtn = document.getElementById('vd-copy-ord');
      if (!ordBtn && _vdc && _vdc.parentNode) {
        ordBtn = document.createElement('button');
        ordBtn.type = 'button';
        ordBtn.className = 'btn btn-outline btn-sm';
        ordBtn.id = 'vd-copy-ord';
        ordBtn.textContent = 'Salin Order';
        _vdc.parentNode.insertBefore(ordBtn, _vdc.nextSibling);
      }
      if (ordBtn) ordBtn.onclick = () => {
        navigator.clipboard.writeText(row.order_no || '');
        toast('Order disalin', 'success');
      };
      toast('VA & struk diterbitkan', 'success');
    };
  }

  async function loadSchedule() { /* removed */ }


  let _rptAll = [];
  let _rptPage = 1;
  async function loadReports() {
    const el = document.getElementById('m-rpt-table');
    if (!el) return;
    try {
      const r = await fetch(API + '/transactions', { headers: authHeaders() });
      const j = await r.json();
      _rptAll = j.data || [];
    } catch (_) { _rptAll = []; }
    _rptPage = 1;
    const search = document.getElementById('m-rpt-search');
    const sort = document.getElementById('m-rpt-sort');
    const size = document.getElementById('m-rpt-pagesize');
    const render = () => {
      let list = _rptAll.slice();
      const q = (search && search.value || '').toLowerCase().trim();
      if (q) {
        list = list.filter(t =>
          JSON.stringify(t).toLowerCase().includes(q)
        );
      }
      const s = (sort && sort.value) || 'date_desc';
      list.sort((a, b) => {
        if (s === 'date_asc') return String(a.created_at || '').localeCompare(String(b.created_at || ''));
        if (s === 'amount_desc') return (Number(b.amount) || 0) - (Number(a.amount) || 0);
        if (s === 'amount_asc') return (Number(a.amount) || 0) - (Number(b.amount) || 0);
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      });
      const ps = Number(size && size.value) || 10;
      const pages = Math.max(1, Math.ceil(list.length / ps));
      if (_rptPage > pages) _rptPage = pages;
      const slice = list.slice((_rptPage - 1) * ps, _rptPage * ps);
      el.innerHTML = `<div class="m-table-wrap"><table class="m-table">
        <thead><tr><th>Tanggal</th><th>Jenis</th><th>Order / Ref</th><th>Nominal</th><th>Status</th><th>Provider</th></tr></thead>
        <tbody>${slice.map(t => `<tr>
          <td>${esc((t.created_at || '').slice(0, 16).replace('T', ' '))}</td>
          <td>${esc((function(t){ var x=String(t.type||''); if(x==='domestic_transfer')return 'Transfer VA'; if(x==='saldo_topup')return 'Aktivasi Saldo'; if(x==='vendor_pay')return 'Vendor Pay'; if(x==='ppob')return 'PPOB'; if(x==='disbursement')return 'Disbursement'; return x; })(t))}</td>
          <td><code>${esc(t.order_no || t.ref_id || '—')}</code></td>
          <td>${fmtRp(t.amount)}</td>
          <td>${esc(t.status)}</td>
          <td>${esc(t.provider || t.bank || '—')}</td>
        </tr>`).join('') || '<tr><td colspan="6">Belum ada transaksi</td></tr>'}
        </tbody></table></div>`;
      const pager = document.getElementById('m-rpt-pager');
      if (pager) {
        let html = `<span style="font-size:.8rem;color:#64748b">${list.length} transaksi · halaman ${_rptPage}/${pages}</span>`;
        for (let i = 1; i <= pages && i <= 12; i++) {
          html += `<button type="button" class="${i === _rptPage ? 'active' : ''}" data-p="${i}">${i}</button>`;
        }
        pager.innerHTML = html;
        pager.querySelectorAll('[data-p]').forEach(b => {
          b.onclick = () => { _rptPage = Number(b.dataset.p); render(); };
        });
      }
    };
    if (search) search.oninput = () => { _rptPage = 1; render(); };
    if (sort) sort.onchange = () => { _rptPage = 1; render(); };
    if (size) size.onchange = () => { _rptPage = 1; render(); };
    render();
  }



  async function loadAudit() {
    const tb = document.querySelector('#m-audit-table tbody');
    if (!tb) return;
    tb.innerHTML = '<tr><td colspan="3">Memuat…</td></tr>';
    try {
      const r = await fetch(API + '/audit', { headers: authHeaders() });
      const j = await r.json();
      const list = (j.data || j.logs || []).slice(0, 50);
      if (!list.length) { tb.innerHTML = '<tr><td colspan="3">Belum ada log audit.</td></tr>'; return; }
      tb.innerHTML = list.map(a => {
        const t = a.created_at || a.time || a.at || '';
        const act = a.action || a.type || '—';
        const det = typeof a.detail === 'object' ? JSON.stringify(a.detail) : (a.detail || a.message || '—');
        return '<tr><td>' + esc(String(t).replace('T',' ').slice(0,19)) + '</td><td>' + esc(act) + '</td><td style="max-width:280px;overflow:hidden;text-overflow:ellipsis">' + esc(String(det).slice(0,120)) + '</td></tr>';
      }).join('');
    } catch (e) {
      tb.innerHTML = '<tr><td colspan="3">Gagal memuat audit</td></tr>';
    }
  }

  async function loadInbox() {
    const box = document.getElementById('m-inbox-box');
    if (!box) return;
    box.innerHTML = `
      <div class="inbox-tabs">
        <button type="button" class="on" data-tab="in">Pesan Masuk</button>
        <button type="button" data-tab="out">Pesan Keluar</button>
        <button type="button" data-tab="compose">Tulis Pesan</button>
      </div>
      <div id="inbox-latest" class="wiz-hint"></div>
      <div id="inbox-list"></div>
      <div id="inbox-compose" class="hidden">
        <div class="form-group"><label>Subjek</label><input id="msg-sub"></div>
        <div class="form-group"><label>Isi pesan</label><textarea id="msg-body" rows="4"></textarea></div>
        <button type="button" class="btn btn-primary" id="msg-send">Kirim ke Admin</button>
      </div>`;
    let all = [];
    try {
      const r = await fetch(API + '/messages', { headers: authHeaders() });
      const j = await r.json();
      all = j.data || [];
    } catch (_) {}
    const inbox = all.filter(m => m.direction === 'in' || m.from === 'admin' || m.to === 'merchant');
    const outbox = all.filter(m => m.direction === 'out' || m.from === 'merchant' || m.to === 'admin');
    // fallback: treat without direction
    const latest = all.slice(0, 5);
    document.getElementById('inbox-latest').textContent = '5 pesan terakhir: ' + latest.length + ' ditampilkan di daftar aktif.';
    const listEl = document.getElementById('inbox-list');
    const show = (arr, cls) => {
      listEl.innerHTML = arr.slice(0, 50).map(m => `
        <div class="msg-item ${cls}">
          <strong>${esc(m.subject || '(tanpa subjek)')}</strong>
          <small>${esc(m.from || '')} → ${esc(m.to || '')} · ${esc((m.created_at || '').slice(0, 16).replace('T', ' '))}</small>
          <p style="margin:6px 0 0">${esc(m.body || '')}</p>
        </div>`).join('') || '<p class="wiz-hint">Tidak ada pesan</p>';
    };
    // default: masuk — messages where to is merchant or from admin
    const masuk = all.filter(m => (m.to === 'merchant' || m.from === 'admin' || m.direction === 'in'));
    const keluar = all.filter(m => (m.from === 'merchant' || m.to === 'admin' || m.direction === 'out'));
    show(masuk.length ? masuk : all.filter(m => m.from !== 'merchant'), 'in');
    document.querySelectorAll('.inbox-tabs button').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.inbox-tabs button').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        const tab = btn.dataset.tab;
        document.getElementById('inbox-compose').classList.toggle('hidden', tab !== 'compose');
        listEl.classList.toggle('hidden', tab === 'compose');
        if (tab === 'in') show(masuk.length ? masuk : all, 'in');
        if (tab === 'out') show(keluar.length ? keluar : [], 'out');
      };
    });
    document.getElementById('msg-send').onclick = async () => {
      if (!requireFields([['msg-sub', 'Subjek'], ['msg-body', 'Isi pesan']])) return;
      const r = await fetch(API + '/messages', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          subject: document.getElementById('msg-sub').value.trim(),
          body: document.getElementById('msg-body').value.trim()
        })
      });
      const j = await r.json();
      toast(j.message || (j.success ? 'Terkirim' : 'Gagal'), j.success ? 'success' : 'error');
      if (j.success) loadInbox();
    };
    updateBell(all);
  }

  function updateBell(msgs) {
    const badge = document.getElementById('m-bell-count');
    if (!badge) return;
    const n = (msgs || []).filter(m => m.unread || m.direction === 'in' || m.from === 'admin').length;
    if (n > 0) {
      badge.textContent = String(n > 99 ? '99+' : n);
      badge.classList.remove('hidden');
    } else badge.classList.add('hidden');
  }

  async function loadPayment() {
    const box = document.getElementById('m-payment-box');
    if (!box) return;
    let cfg = { mode: 'sandbox', providers: ['bdpay','midtrans','doku','xendit'], methods: ['va','qris'] };
    try {
      const r = await fetch(API + '/payment/config', { headers: authHeaders() });
      const j = await r.json();
      if (j.success) cfg = j.data;
    } catch (_) {}
    box.innerHTML = `
      <p class="wiz-hint">Webhook: <code>/api/callback/{provider}</code> atau <code>/api/merchant/webhook/{provider}</code>. Default mode <strong>sandbox</strong>.</p>
      <label>Mode</label>
      <select id="pay-mode">
        <option value="simulation">simulation (tanpa gateway)</option>
        <option value="sandbox" selected>sandbox (default)</option>
        <option value="production">production (kredensial live)</option>
      </select>
      <label>Provider</label>
      <select id="pay-prov">${(cfg.providers||[]).map(p=>'<option value="'+p+'">'+p+'</option>').join('')}</select>
      <label>Metode</label>
      <select id="pay-method"><option value="va">Virtual Account</option><option value="qris">QRIS</option></select>
      <label>Nominal (Rp)</label>
      <input id="pay-amt" inputmode="numeric" placeholder="100000" value="100000">
      <label>Keterangan</label>
      <input id="pay-desc" placeholder="Top-up / tagihan vendor">
      <div class="wiz-actions">
        <button type="button" class="btn btn-primary" id="pay-create">Terbitkan QRIS / VA</button>
        <button type="button" class="btn btn-outline" id="pay-sim">Tandai Paid (Simulasi)</button>
      </div>
      <div id="pay-result" style="margin-top:12px"></div>
    `;
    document.getElementById('pay-mode').value = cfg.mode || 'sandbox';
    document.getElementById('pay-create').onclick = async () => {
      const body = {
        mode: document.getElementById('pay-mode').value,
        provider: document.getElementById('pay-prov').value,
        method: document.getElementById('pay-method').value,
        amount: Number(String(document.getElementById('pay-amt').value).replace(/\D/g,'')),
        description: document.getElementById('pay-desc').value
      };
      const r = await fetch(API + '/payment/create', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
      const j = await r.json();
      const el = document.getElementById('pay-result');
      if (j.success) {
        const d = j.data || {};
        el.innerHTML = `<div style="padding:12px;background:#f0fdf4;border-radius:10px;font-size:.85rem">
          <strong>${d.method?.toUpperCase()} · ${d.provider} · ${d.mode}</strong><br>
          Order: <code>${d.order_no||''}</code><br>
          ${d.va_number ? ('VA: <code>'+d.va_number+'</code><br>') : ''}
          ${d.qris_payload ? ('QRIS: <code style="word-break:break-all">'+d.qris_payload+'</code><br>') : ''}
          Nominal: Rp ${Number(d.amount||0).toLocaleString('id-ID')}<br>
          Status: pending
          <div style="margin-top:8px">
            <button type="button" class="btn btn-outline btn-sm" id="pay-copy">Salin</button>
          </div>
        </div>`;
        window.__lastPayOrder = d.order_no;
        window.__lastPayVA = d.va_number;
        document.getElementById('pay-copy')?.addEventListener('click', () => {
          navigator.clipboard.writeText(d.transaction?.share_text || d.order_no);
          toast('Disalin', 'success');
        });
        toast(j.message || 'OK', 'success');
      } else {
        el.innerHTML = '<p style="color:#b91c1c">' + (j.message||'Gagal') + '</p>';
        toast(j.message||'Gagal', 'error');
      }
    };
    document.getElementById('pay-sim').onclick = async () => {
      const r = await fetch(API + '/payment/simulate-pay', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ order_no: window.__lastPayOrder, va_number: window.__lastPayVA })
      });
      const j = await r.json();
      toast(j.message || '', j.success ? 'success' : 'error');
      if (j.success) loadDashboard();
    };
  }


  async function loadSaldo() {
    const box = document.getElementById('m-saldo-box');
    if (!box) return;
    let last = null;
    box.innerHTML = '<p class="wiz-hint">Inquiry rekening, terbitkan VA top-up. Pembayaran VA dilakukan di luar sistem / Simulasi Bayar VA di Backend Admin. Setelah paid, rekening aktif untuk disbursement.</p>' +
      '<div class="m-form-grid">' +
      '<div class="form-group"><label>Bank <span class="req">*</span></label><select id="sa-bank">' + bankOptionsHtml('bni') + '</select></div>' +
      '<div class="form-group"><label>Rekening <span class="req">*</span></label><input id="sa-acc" placeholder="Nomor rekening" required></div>' +
      '<div class="form-group"><label>Nama</label><input id="sa-name" readonly placeholder="Hasil inquiry"></div>' +
      '<div class="form-group"><label>Nominal top-up <span class="req">*</span></label><input id="sa-amt" value="100.000" inputmode="numeric" required></div></div>' +
      '<div class="wiz-actions">' +
      '<button type="button" class="btn btn-outline" id="sa-inq">Inquiry</button>' +
      '<button type="button" class="btn btn-primary" id="sa-va">Terbitkan VA</button></div>' +
      '<div id="sa-out"></div><div id="sa-accounts"></div>';
    wireCurrency('sa-amt');
    document.getElementById('sa-inq').onclick = async function () {
      const account = document.getElementById('sa-acc').value.trim();
      if (!account) return toast('Rekening wajib', 'warn');
      const r = await fetch(API + '/inquiry-account', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ bank: document.getElementById('sa-bank').value, account: account })
      });
      const j = await r.json();
      if (j.success) {
        document.getElementById('sa-name').value = j.data.name || j.data.account_name || '';
        toast('Inquiry OK', 'success');
      } else toast(j.message || 'Gagal', 'error');
    };
    document.getElementById('sa-va').onclick = async function () {
      if (!requireFields([['sa-acc', 'Rekening'], ['sa-amt', 'Nominal']])) return;
      const amount = parseCurrency(document.getElementById('sa-amt').value);
      if (amount < 10000) return toast('Minimal Rp 10.000', 'warn');
      const r = await fetch(API + '/saldo/activate', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          bank: document.getElementById('sa-bank').value,
          account: document.getElementById('sa-acc').value.trim(),
          name: document.getElementById('sa-name').value.trim() || ('PENERIMA ' + document.getElementById('sa-acc').value.slice(-4)),
          amount: amount
        })
      });
      const j = await r.json();
      if (!j.success) return toast(j.message || 'Gagal', 'error');
      last = j.data;
      document.getElementById('sa-out').innerHTML = renderVAResult(j.data, 'Aktivasi Saldo & Rekening');
      toast('VA top-up diterbitkan — bayar via Admin Simulasi Bayar VA', 'info');
    };
    // list accounts
    try {
      const r = await fetch(API + '/accounts', { headers: authHeaders() });
      const j = await r.json();
      const accs = j.data || [];
      if (accs.length) {
        document.getElementById('sa-accounts').innerHTML = '<h4 style="margin:16px 0 10px">Rekening Aktif</h4><div class="m-accounts-list">' +
          accs.map(function (a) {
            var bank = String(a.bank || '-');
            return '<div class="m-account-card"><div class="bank-badge">' + esc(bank.slice(0, 4)) + '</div>' +
              '<div class="acc-meta"><strong>' + esc(a.name || '-') + '</strong>' +
              '<span>' + esc(bank.toUpperCase()) + ' · ' + esc(a.account || '-') + '</span></div></div>';
          }).join('') + '</div>';
      }
    } catch (_) {}
  }


  function renderDisburseSlip(d) {
    d = d || {};
    const ord = d.order_no || d.ref_id || '';
    const rows =
      '<tr><th>Nomor Order</th><td><code>' + esc(ord) + '</code></td></tr>' +
      '<tr><th>Rekening Tujuan</th><td>' + esc((d.bank || '').toUpperCase()) + ' · ' + esc(d.account || '') + ' — ' + esc(d.name || '') + '</td></tr>' +
      '<tr><th>Nominal</th><td>' + fmtRp(d.amount) + '</td></tr>' +
      (d.fee_lines || []).map(function (l) { return '<tr><th>' + esc(l.name || 'Biaya Layanan') + '</th><td>' + fmtRp(l.amount) + '</td></tr>'; }).join('') +
      (d.tax_lines || []).map(function (l) { return '<tr><th>' + esc(l.name || 'Pajak') + '</th><td>' + fmtRp(l.amount) + '</td></tr>'; }).join('') +
      ((!(d.fee_lines && d.fee_lines.length) && d.fee) ? '<tr><th>Biaya Layanan</th><td>' + fmtRp(d.fee) + '</td></tr>' : '') +
      ((!(d.tax_lines && d.tax_lines.length) && d.tax) ? '<tr><th>Pajak</th><td>' + fmtRp(d.tax) + '</td></tr>' : '') +
      '<tr><th>Total Debit Saldo</th><td><strong>' + fmtRp(d.grand_total != null ? d.grand_total : d.amount) + '</strong></td></tr>' +
      '<tr><th>Tujuan Transfer</th><td><strong>Bisnis</strong></td></tr>' +
      '<tr><th>Status</th><td>' + esc(d.status || 'success') + '</td></tr>' +
      '<tr><th>Waktu</th><td>' + esc(d.created_at || '') + '</td></tr>';
    return '<div class="receipt" id="disburse-slip"><h3>Tanda Kirim Disbursement</h3><table>' + rows + '</table>' +
      '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="btn btn-outline btn-sm" id="db-print">Unduh / Cetak PDF</button>' +
      '<button type="button" class="btn btn-outline btn-sm" id="db-copy-order">Salin Order</button></div></div>';
  }

  async function loadDisbursement() {
    const box = document.getElementById('m-disburse-box');
    if (!box) return;
    let accounts = [];
    try {
      const r = await fetch(API + '/accounts', { headers: authHeaders() });
      const j = await r.json();
      accounts = j.data || [];
    } catch (_) {}
    if (!accounts.length) {
      box.innerHTML = '<p class="wiz-hint">Belum ada rekening aktif. Daftarkan di menu <strong>Aktivasi Saldo &amp; Rekening</strong>.</p>' +
        '<button type="button" class="btn btn-primary" id="db-go-saldo">Ke Aktivasi Saldo</button>';
      document.getElementById('db-go-saldo').onclick = function () { showSection('saldo'); };
      return;
    }
    box.innerHTML = '<div class="m-form-grid">' +
      '<div class="form-group"><label>Rekening tujuan (aktif)</label><select id="db-acc">' +
      accounts.map(function (a) {
        return '<option value="' + esc(a.id) + '">' + esc(a.bank) + ' · ' + esc(a.account) + ' — ' + esc(a.name) + '</option>';
      }).join('') +
      '</select></div>' +
      '<div class="form-group"><label>Nominal (Rp)</label><input id="db-amt" value="50.000"></div></div>' +
      '<button type="button" class="btn btn-primary" id="db-go" style="margin-top:12px">Lanjutkan Disbursement</button><div id="db-out"></div>';
    wireCurrency('db-amt');
    document.getElementById('db-go').onclick = async function () {
      const amount = parseCurrency(document.getElementById('db-amt').value);
      if (amount < 10000) return toast('Minimal Rp 10.000', 'warn');
      const r = await fetch(API + '/disburse', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ account_id: document.getElementById('db-acc').value, amount: amount })
      });
      const j = await r.json();
      toast(j.message || '', j.success ? 'success' : 'error');
      if (j.success) {
        const out = document.getElementById('db-out');
        if (out) {
          out.innerHTML = renderDisburseSlip(j.data || {});
          document.getElementById('db-print')?.addEventListener('click', function () {
            const html = document.getElementById('disburse-slip')?.outerHTML || '';
            const w = window.open('', '_blank');
            if (!w) return toast('Popup diblokir', 'warn');
            w.document.write('<html><head><title>Tanda Kirim Disbursement</title><style>body{font-family:system-ui;padding:24px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #e2e8f0;text-align:left}th{width:40%;color:#64748b}@media print{button{display:none}}</style></head><body>' + html + '<script>setTimeout(function(){window.print()},400)</script></body></html>');
            w.document.close();
          });
          document.getElementById('db-copy-order')?.addEventListener('click', function () {
            const o = (j.data && (j.data.order_no || j.data.ref_id)) || '';
            navigator.clipboard?.writeText(o).then(function () { toast('Order disalin', 'success'); });
          });
        }
        await refreshMe();
        loadDashboard();
      }
    };
  }

  async function loadPpob() {
    const box = document.getElementById('m-ppob-box');
    if (!box) return;
    let products = [];
    try {
      const r = await fetch('/api/products');
      const j = await r.json();
      products = (j.data || j.products || []).filter(function (p) { return p.active !== false; });
    } catch (_) {}
    box.innerHTML = '<p class="wiz-hint">Pilih produk → keranjang otomatis → bayar VA/QRIS. Konfirmasi pembayaran via callback gateway atau Simulasi Bayar VA di Backend Admin.</p>' +
      '<div class="form-group"><label>Produk <span class="req">*</span></label><select id="pp-prod">' +
      (products.map(function (p) {
        return '<option value="' + esc(p.id) + '">' + esc(p.name) + ' — ' + fmtRp(p.price || p.sell_price) + '</option>';
      }).join('') || '<option value="">— tidak ada —</option>') +
      '</select></div>' +
      '<div class="form-group"><label>Nomor tujuan <span class="req">*</span></label><input id="pp-cust" placeholder="08…" required></div>' +
      '<div class="form-group"><label>Metode Pembayaran <span class="req">*</span></label><select id="pp-method"><option value="va">Virtual Account</option><option value="qris">QRIS</option></select></div>' +
      '<div id="pp-cart" class="receipt" style="display:none"></div>' +
      '<div class="wiz-actions"><button type="button" class="btn btn-primary" id="pp-buy">Proses Pembelian</button></div>' +
      '<div id="pp-out"></div>';
    async function refreshQuote() {
      const pid = document.getElementById('pp-prod').value;
      if (!pid) { document.getElementById('pp-cart').style.display = 'none'; return; }
      const r = await fetch(API + '/ppob/quote?product_id=' + encodeURIComponent(pid), { headers: authHeaders() });
      const j = await r.json();
      const cart = document.getElementById('pp-cart');
      if (!j.success) { cart.style.display = 'none'; return; }
      const d = j.data;
      cart.style.display = 'block';
      cart.innerHTML = '<h3>Keranjang</h3><table>' +
        '<tr><th>Harga</th><td>' + fmtRp(d.product.price) + '</td></tr>' +
        (d.fee_lines || []).map(function (l) { return '<tr><th>' + esc(l.name) + '</th><td>' + fmtRp(l.amount) + '</td></tr>'; }).join('') +
        (d.tax_lines || []).map(function (l) { return '<tr><th>' + esc(l.name) + '</th><td>' + fmtRp(l.amount) + '</td></tr>'; }).join('') +
        '<tr><th><strong>Total</strong></th><td><strong>' + fmtRp(d.total) + '</strong></td></tr></table>' +
        '<p class="wiz-hint">S&amp;K dan Agreement sudah disetujui di Kartu Registrasi / Profil.</p>';
    }
    document.getElementById('pp-prod').onchange = refreshQuote;
    refreshQuote();
    document.getElementById('pp-buy').onclick = async function () {
      if (!requireFields([['pp-prod', 'Produk'], ['pp-cust', 'Nomor tujuan']])) return;
      const r = await fetch(API + '/ppob', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          product_id: document.getElementById('pp-prod').value,
          customer_no: document.getElementById('pp-cust').value.trim(),
          payment_method: document.getElementById('pp-method').value
        })
      });
      const j = await r.json();
      if (!j.success) {
        document.getElementById('pp-out').innerHTML = '<p style="color:#b91c1c">' + esc(j.message) + '</p>';
        return toast(j.message || 'Gagal', 'error');
      }
      const d = j.data || {};
      document.getElementById('pp-out').innerHTML = renderVAResult(d, 'Menunggu Pembayaran — ' + esc((d.payment_method || 'va').toUpperCase()));
      toast(j.message || 'Menunggu pembayaran', 'info');
    };
  }

  /* boot */
  if (loadSession() && sessionStorage.getItem('merchant_token')) {
    showApp();
  } else if (localStorage.getItem('bdpay_merchant_token')) {
    try { startMerchantIdle(); } catch (_) {}
  }
})();


(function(){
  const nf = window.fetch.bind(window);
  const paths = ['/api/merchant/transfer', '/api/merchant/vendor-pay', '/api/merchant/ppob', '/api/merchant/saldo', '/api/merchant/disburse'];
  window.fetch = async function(input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = ((init && init.method) || 'GET').toUpperCase();
      if (method === 'POST' && paths.some(p => url.includes(p))) {
        const ok = await ensureMerchantPin();
        if (!ok) return new Response(JSON.stringify({ success: false, message: 'PIN diperlukan — masukkan 6 digit PIN' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
    } catch(_) {}
    return nf(input, init);
  };
})();

document.addEventListener('DOMContentLoaded', async () => {
  await loadGoogleConfig();
  initMerchantGoogle();
  if (window.BdSecurity) BdSecurity.loadCaptcha('captcha-box-m-login');
  else setTimeout(function(){ if (window.BdSecurity) BdSecurity.loadCaptcha('captcha-box-m-login'); }, 400);
});
