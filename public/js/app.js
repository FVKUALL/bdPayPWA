
async function ensureTxPin() {
  const user = getUser();
  if (!user) return false;
  if (!user.pin_set) {
    const pin = await (window.BdSecurity ? BdSecurity.requestPin({ title: 'Atur PIN Transaksi', desc: 'Buat PIN 6 digit (Demo: 123456)' }) : prompt('PIN 6 digit'));
    if (!pin) return false;
    const r = await fetch(API + '/pin/set', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: user.id, pin }) });
    const j = await r.json();
    if (!j.success) { showToast(j.message || 'Gagal set PIN', 'error'); return false; }
    user.pin_set = true;
    setUser(user);
    showToast('PIN berhasil diatur', 'success');
    return true;
  }
  const pin = await (window.BdSecurity ? BdSecurity.requestPin({ title: 'PIN Transaksi', desc: 'Masukkan PIN 6 digit (Demo: 123456)' }) : prompt('PIN'));
  if (!pin) return false;
  const r = await fetch(API + '/pin/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: user.id, pin }) });
  const j = await r.json();
  if (!j.success) { showToast(j.message || 'PIN salah', 'error'); return false; }
  return true;
}

/**
 * PPOB Mobile Site Frontend
 * LocalStorage for session + fetch to JSON-backed API
 * W3C compliant, mobile-first, PWA-ready
 */

const API = '/api';

function parseIdr(val) {
  if (val == null || val === '') return 0;
  const n = String(val).replace(/[^\d]/g, '');
  return n ? Number(n) : 0;
}
const STORAGE_KEY = 'ppob_user';

/** In-app notification (ganti alert/confirm browser) */
function showToast(message, type = 'info', ms = 3500) {
  const root = document.getElementById('toast-root') || document.body;
  const el = document.createElement('div');
  const colors = { info: '#0d6efd', success: '#198754', error: '#dc3545', warn: '#fd7e14' };
  el.style.cssText = 'pointer-events:auto;margin:8px 0;padding:12px 16px;border-radius:10px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.15);border-left:4px solid '+(colors[type]||colors.info)+';font-size:0.9rem;line-height:1.4';
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, ms);
}
function showConfirm(message) {
  return new Promise((resolve) => {
    const root = document.getElementById('toast-root') || document.body;
    const box = document.createElement('div');
    box.style.cssText = 'pointer-events:auto;margin:8px 0;padding:16px;border-radius:12px;background:#fff;box-shadow:0 12px 32px rgba(0,0,0,.2);font-size:0.9rem';
    box.innerHTML = '<div style="margin-bottom:12px">'+message+'</div><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-outline btn-sm" data-a="n">Batal</button><button class="btn btn-primary btn-sm" data-a="y">OK</button></div>';
    root.appendChild(box);
    box.querySelector('[data-a="y"]').onclick = () => { box.remove(); resolve(true); };
    box.querySelector('[data-a="n"]').onclick = () => { box.remove(); resolve(false); };
  });
}

// ========== Utils ==========
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function getUser() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch { return null; }
}

function setUser(user) {
  if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  else localStorage.removeItem(STORAGE_KEY);
  updateHeader();
  if (window.BdSecurity) {
    if (user) {
      BdSecurity.startIdleWatch({
        onLogout: () => {
          try { setUser(null); } catch (_) {}
          if (typeof showToast === 'function') showToast('Sesi berakhir. Silakan login kembali.', 'warn');
          setTimeout(function () {
            if (typeof openLoginModal === 'function') openLoginModal();
            else location.reload();
          }, 300);
        }
      });
    } else BdSecurity.stopIdleWatch();
  }
}

function updateHeader() {
  try {
    const user = getUser();
    const btnLogin = $('#btn-login');
    const btnRegister = $('#btn-register');
    const userMenu = $('#user-menu');
    if (!btnLogin || !btnRegister || !userMenu) return;
    if (user) {
      btnLogin.classList.add('hidden');
      btnRegister.classList.add('hidden');
      userMenu.classList.remove('hidden');
      const un = $('#user-name');
      if (un) un.textContent = user.username || user.email || 'User';
      if (!$('#btn-history')) {
        const btn = document.createElement('button');
        btn.id = 'btn-history';
        btn.className = 'btn btn-sm btn-outline';
        btn.textContent = 'Riwayat';
        btn.onclick = openHistoryModal;
        const logout = $('#btn-logout');
        if (logout) userMenu.insertBefore(btn, logout);
        else userMenu.appendChild(btn);
      }
      if (!$('#btn-profile')) {
        const bp = document.createElement('button');
        bp.id = 'btn-profile';
        bp.className = 'btn btn-sm btn-outline';
        bp.textContent = 'Profil';
        bp.onclick = openProfileModal;
        const hist = $('#btn-history');
        if (hist) userMenu.insertBefore(bp, hist);
        else userMenu.appendChild(bp);
      }
    } else {
      btnLogin.classList.remove('hidden');
      btnRegister.classList.remove('hidden');
      userMenu.classList.add('hidden');
      const bh = $('#btn-history');
      if (bh) bh.remove();
      const bp = $('#btn-profile');
      if (bp) bp.remove();
    }
  } catch (e) { console.warn('updateHeader', e); }
}

function showModal(html) {
  $('#modal-content').innerHTML = html;
  $('#modal-overlay').classList.remove('hidden');
}

function closeModal() {
  $('#modal-overlay').classList.add('hidden');
  $('#modal-content').innerHTML = '';
}

function formatRupiah(n) {
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}

// ========== Load Config & CMS ==========
async function loadConfig() {
  try {
    const res = await fetch(`${API}/public/config`);
    const json = await res.json();
    if (!json.success) return;
    const { site, seo, cms, tnc } = json.data;

    document.title = seo.title || 'PPOB Mobile';
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.content = seo.description || '';

    const logo = document.getElementById('site-logo');
    if (logo) logo.textContent = site.name || 'bdPay PWA';
    const ht = document.getElementById('hero-title');
    if (ht) ht.textContent = (cms.pages && cms.pages.home && cms.pages.home.hero_title) || 'bdPay PWA — PPOB & Transfer Domestik';
    const hs = document.getElementById('hero-subtitle');
    if (hs) hs.textContent = (cms.pages && cms.pages.home && cms.pages.home.hero_subtitle) || '';
    const cp = document.getElementById('copyright');
    if (cp) cp.textContent = '© ' + (site.copyright || 'bdPay') + (site.license ? ' · ' + site.license : '');

    // Features (segmen dihapus dari beranda — biarkan no-op jika elemen tidak ada)
    const grid = document.getElementById('features-grid');
    if (grid) grid.innerHTML = '';

    // Kontak CMS
    const c = cms.contact || {};
    const setTxt = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.textContent = v; };
    setTxt('contact-title', c.title || 'Kontak & Informasi');
    setTxt('contact-desc', c.description || '');
    setTxt('contact-phone', c.phone || '');
    setTxt('contact-address', c.address || '');
    setTxt('contact-hours', c.hours || '');
    const em = document.getElementById('contact-email');
    if (em && c.email) { em.textContent = c.email; em.href = 'mailto:' + c.email; }
    const wa = document.getElementById('contact-wa');
    if (wa && c.whatsapp) {
      const num = String(c.whatsapp).replace(/\D/g, '');
      wa.href = 'https://wa.me/' + num;
      wa.textContent = 'Chat WhatsApp';
    }

    // Store T&C & Google config
    window.__tnc = tnc;
    window.__google = json.data.google || { client_id: '', enabled: true };
    window.__kyc = json.data.kyc || {};
    window.__fees = json.data.fees;
    window.__taxes = json.data.taxes;
  } catch (e) {
    console.error('Config load error', e);
  }
}

// ========== Products ==========
let allProducts = [];

async function loadProducts() {
  const grid = document.getElementById('products-grid');
  if (grid) grid.innerHTML = '<p style="text-align:center;color:#6c757d;padding:16px">Memuat produk…</p>';
  const FALLBACK = [
    { id: 'prod-001', name: 'Pulsa Telkomsel 10.000', sku: 'TSEL10', category: 'prabayar', provider: 'Telkomsel', price: 10500, active: true },
    { id: 'prod-002', name: 'Token Listrik PLN 20.000', sku: 'PLN20', category: 'prabayar', provider: 'PLN', price: 20500, active: true },
    { id: 'prod-003', name: 'Tagihan PDAM', sku: 'PDAM', category: 'pascabayar', provider: 'PDAM', price: 0, active: true },
    { id: 'prod-004', name: 'Paket Data XL 5GB', sku: 'XL5GB', category: 'prabayar', provider: 'XL', price: 45000, active: true },
    { id: 'prod-005', name: 'BPJS Kesehatan', sku: 'BPJSKES', category: 'pascabayar', provider: 'BPJS', price: 0, active: true }
  ];
  try {
    const res = await fetch(API + '/products', { cache: 'no-store' });
    const json = await res.json();
    if (json.success && Array.isArray(json.data) && json.data.length) {
      allProducts = json.data;
    } else {
      allProducts = FALLBACK;
      console.warn('products empty/API fail, using fallback', json);
    }
  } catch (e) {
    console.error('loadProducts', e);
    allProducts = FALLBACK;
  }
  renderProducts('all');
}

function renderProducts(cat) {
  const grid = document.getElementById('products-grid');
  if (!grid) { console.warn('products-grid missing'); return; }
  let list = Array.isArray(allProducts) ? allProducts : [];
  if (cat && cat !== 'all') list = list.filter(p => p.category === cat);
  list = list.filter(p => p && p.active !== false);

  if (!list.length) {
    grid.innerHTML = '<p style="text-align:center;color:#6c757d;padding:24px">Tidak ada produk aktif. Hubungi admin.</p>';
    return;
  }

  grid.innerHTML = list.map(p => {
    const id = String(p.id || '').replace(/'/g, '');
    const name = String(p.name || 'Produk');
    const provider = String(p.provider || '');
    const catLabel = p.category === 'pascabayar' ? 'Pascabayar' : 'Prabayar';
    const price = Number(p.price) > 0 ? formatRupiah(p.price) : 'Inquiry';
    return '<div class="product-card">' +
      '<span class="category-badge ' + (p.category || 'prabayar') + '">' + catLabel + '</span>' +
      '<h3>' + name + '</h3>' +
      '<div class="provider">' + provider + '</div>' +
      '<div class="price">' + price + '</div>' +
      '<button type="button" class="btn btn-primary btn-block" data-product-id="' + id + '">Beli Sekarang</button>' +
      '</div>';
  }).join('');

  grid.querySelectorAll('[data-product-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.getAttribute('data-product-id');
      if (typeof openBuyModal === 'function') openBuyModal(pid);
    });
  });
}

// ========== FAQ ==========
async function loadFaqs() {
  try {
    const res = await fetch(API + '/faqs', { cache: 'no-store' });
    const json = await res.json();
    if (!json.success) return;
    const list = document.getElementById('faq-list');
    if (!list) return;
    list.innerHTML = (json.data || []).map(f => `
      <div class="faq-item">
        <div class="faq-question">${f.question}</div>
        <div class="faq-answer">${f.answer}</div>
      </div>
    `).join('');

    $$('.faq-question').forEach(q => {
      q.addEventListener('click', () => {
        q.parentElement.classList.toggle('open');
      });
    });
  } catch (e) {
    console.error(e);
  }
}

// ========== Auth Modals ==========
function googleAuthButtonsHtml(containerId) {
  return `
    <div id="${containerId}" style="margin:12px 0;text-align:center"></div>
    <div style="text-align:center;margin:8px 0;color:#6c757d;font-size:0.85rem">— atau —</div>
  `;
}

function renderGoogleButton(containerId) {
  const g = window.__google || {};
  const el = document.getElementById(containerId);
  if (!el) return;

  if (g.enabled && g.client_id) {
    // Real Google Identity Services
    if (!window.google?.accounts) {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => initGoogleBtn(containerId, g.client_id);
      document.head.appendChild(s);
    } else {
      initGoogleBtn(containerId, g.client_id);
    }
  } else {
    // Demo Google button (simulasi)
    el.innerHTML = `
      <button type="button" class="btn btn-block" id="btn-google-demo" style="background:#fff;border:1px solid #dadce0;color:#3c4043;display:flex;align-items:center;justify-content:center;gap:10px;padding:10px">
        <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
        Lanjutkan dengan Google (Demo)
      </button>
    `;
    $('#btn-google-demo')?.addEventListener('click', () => doGoogleDemoLogin());
  }
}

function initGoogleBtn(containerId, clientId) {
  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: async (response) => {
      try {
        const res = await fetch(`${API}/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: response.credential })
        });
        const json = await res.json();
        if (json.success) {
          setUser(json.data);
          closeModal();
          afterAuthRedirect(json.data);
        } else {
          showToast(json.message || 'Google login gagal', 'error');
        }
      } catch {
        showToast('Gagal terhubung ke server', 'error');
      }
    }
  });
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  window.google.accounts.id.renderButton(el, {
    theme: 'outline',
    size: 'large',
    width: el.offsetWidth || 320,
    text: 'continue_with',
    locale: 'id'
  });
}

function afterAuthRedirect(user) {
  // Profil belum lengkap → wajib ke halaman Profil
  if (!user.profile_completed) {
    setTimeout(() => openProfileModal(), 350);
  }
}

async function doGoogleDemoLogin() {
  const demoPayload = {
    email: 'google.demo@gmail.com',
    name: 'Google Demo User',
    sub: 'google-demo-sub-001',
    picture: ''
  };
  try {
    const res = await fetch(`${API}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ demo_payload: demoPayload })
    });
    const json = await res.json();
    if (json.success) {
      setUser(json.data);
      closeModal();
      afterAuthRedirect(json.data);
    } else {
      showToast(json.message || 'Gagal', 'error');
    }
  } catch (err) {
    console.error('Google demo login', err);
    showToast('Gagal terhubung ke server. Pastikan npm start berjalan di localhost:3000', 'error', 5000);
  }
}

async function loginAsDemo() {
  try {
    const res = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'demo', demo: true })
    });
    const json = await res.json();
    if (json.success) {
      setUser(json.data);
      closeModal();
    } else {
      showToast(json.message || 'Demo login gagal', 'error');
    }
  } catch {
    showToast('Gagal terhubung', 'error');
  }
}

function openRegisterModal() {
  showModal(`
    <h2>Daftar Akun</h2>
    <p style="font-size:0.85rem;color:#6c757d;margin-bottom:12px">Daftar hanya dengan <strong>Email</strong> atau Google. Verifikasi, KYC, T&amp;C &amp; Agreement dilengkapi di halaman <strong>Profil</strong>.</p>
    ${googleAuthButtonsHtml('google-btn-reg')}
    <form id="form-register">
      <div id="captcha-box-register" class="form-group"></div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" name="email" required placeholder="email@contoh.com">
      </div>
      <div id="reg-alert"></div>
      <button type="submit" class="btn btn-primary btn-block">Daftar</button>
    </form>
    <p style="text-align:center;margin-top:12px;font-size:0.9rem">
      Sudah punya akun? <a href="#" id="switch-to-login">Masuk</a>
    </p>
  `);
  renderGoogleButton('google-btn-reg');

  if (window.BdSecurity) BdSecurity.loadCaptcha('captcha-box-register');
  $('#form-register').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    body.tnc_accepted = true; // T&C formal di Profil
    const alertBox = $('#reg-alert');
    try {
      const cap = window.BdSecurity ? BdSecurity.getCaptchaPayload(e.target) : {};
      const res = await fetch(`${API}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, ...cap })
      });
      const json = await res.json();
      if (json.success) {
        // auto-login without captcha: use registration success payload
        if (json.data && json.data.id) {
          setUser({ ...json.data, pin_set: false });
          showToast('Registrasi berhasil. Lengkapi profil Anda.', 'success');
          setTimeout(() => { closeModal(); openProfileModal(); }, 500);
          return;
        }
        const loginRes = await fetch(`${API}/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: body.email })
        });
        const loginJson = await loginRes.json();
        if (loginJson.success) {
          setUser(loginJson.data);
          showToast('Registrasi berhasil. Lengkapi profil Anda.', 'success');
          setTimeout(() => { closeModal(); openProfileModal(); }, 500);
        } else {
          showToast(json.message + ' Silakan masuk.', 'success');
          setTimeout(() => { closeModal(); openLoginModal(); }, 800);
        }
      } else {
        alertBox.innerHTML = `<div class="alert alert-error">${json.message}</div>`;
        if (window.BdSecurity) BdSecurity.loadCaptcha('captcha-box-register');
      }
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">Gagal terhubung ke server</div>`;
    }
  });

  $('#switch-to-login')?.addEventListener('click', (e) => {
    e.preventDefault();
    openLoginModal();
  });
}

function openLoginModal() {
  showModal(`
    <h2>Masuk</h2>
    ${googleAuthButtonsHtml('google-btn-login')}
    <form id="form-login">
      <div class="form-group">
        <label>Email atau Username</label>
        <input type="text" name="identifier" id="login-identifier" required placeholder="email, username, atau admin">
      </div>
      <div class="form-group" id="login-pass-wrap" style="display:none">
        <label>Password (Admin)</label>
        <div style="display:flex;gap:8px">
          <input type="password" name="password" id="login-password" placeholder="Password admin" style="flex:1">
          <button type="button" class="btn btn-outline btn-sm" id="toggle-login-pass">👁</button>
        </div>
        <p style="font-size:0.75rem;color:#6c757d;margin-top:4px">Panel admin: /admin/ · default admin / admin123</p>
      </div>
      <div id="captcha-box-login" class="form-group"></div>
      <div id="login-alert"></div>
      <button type="submit" class="btn btn-primary btn-block">Masuk</button>
    </form>
    <div style="margin-top:16px;padding:12px;background:#f0f7ff;border-radius:8px;border:1px dashed #0d6efd">
      <div style="font-size:0.85rem;font-weight:600;margin-bottom:6px;color:#0d6efd">Akun Demo (klik untuk isi & login)</div>
      <button type="button" class="btn btn-outline btn-block" id="btn-demo-login" style="justify-content:flex-start;text-align:left">
        <span>
          <strong>demo</strong> / demo@ppob.local<br>
          <small style="color:#6c757d">Klik → langsung masuk sebagai demo user</small>
        </span>
      </button>
    </div>
    <p style="text-align:center;margin-top:12px;font-size:0.9rem">
      Belum punya akun? <a href="#" id="switch-to-reg">Daftar</a>
    </p>
  `);
  renderGoogleButton('google-btn-login');

  $('#login-identifier')?.addEventListener('input', (e) => {
    const v = (e.target.value || '').toLowerCase();
    const wrap = $('#login-pass-wrap');
    if (wrap) wrap.style.display = (v === 'admin' || v.includes('admin@')) ? 'block' : 'none';
  });
  $('#toggle-login-pass')?.addEventListener('click', () => {
    const i = $('#login-password');
    if (!i) return;
    i.type = i.type === 'password' ? 'text' : 'password';
    $('#toggle-login-pass').textContent = i.type === 'password' ? '👁' : '🙈';
  });

  if (window.BdSecurity) BdSecurity.loadCaptcha('captcha-box-login');
  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const identifier = e.target.identifier.value;
    const alertBox = $('#login-alert');
    const idf = (identifier || '').toLowerCase().trim();
    if (idf === 'admin' || idf === 'admin@bdpay.local') {
      const pw = $('#login-password')?.value || '';
      $('#login-pass-wrap').style.display = 'block';
      if (!pw) {
        alertBox.innerHTML = '<div class="alert alert-error">Masukkan password admin</div>';
        showToast('Masukkan password admin', 'warn');
        return;
      }
      // Simpan untuk autofill admin panel
      try {
        sessionStorage.setItem('x-admin-user', 'admin');
        sessionStorage.setItem('x-admin-pass', pw);
      } catch (_) {}
      showToast('Membuka panel Admin…', 'info');
      window.location.href = '/admin/';
      return;
    }
    try {
      const cap = window.BdSecurity ? BdSecurity.getCaptchaPayload(e.target) : {};
      const res = await fetch(`${API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, ...cap })
      });
      const json = await res.json();
      if (json.success) {
        setUser(json.data);
        alertBox.innerHTML = `<div class="alert alert-success">Berhasil masuk!</div>`;
        showToast('Berhasil masuk', 'success');
        setTimeout(() => {
          closeModal();
          afterAuthRedirect(json.data);
        }, 600);
      } else {
        alertBox.innerHTML = `<div class="alert alert-error">${json.message || 'Login gagal'}</div>`;
        showToast(json.message || 'Login gagal', 'error');
        if (window.BdSecurity) BdSecurity.loadCaptcha('captcha-box-login');
      }
    } catch {
      alertBox.innerHTML = `<div class="alert alert-error">Gagal terhubung</div>`;
      showToast('Gagal terhubung', 'error');
    }
  });

  $('#btn-demo-login')?.addEventListener('click', async () => {
    const input = $('#login-identifier');
    if (input) input.value = 'demo';
    await loginAsDemo();
    const u = getUser();
    if (u) afterAuthRedirect(u);
  });

  $('#switch-to-reg')?.addEventListener('click', (e) => {
    e.preventDefault();
    openRegisterModal();
  });
}

// ========== Buy Modal ==========
function openBuyModal(productId) {
  const user = getUser();
  if (!user) {
    openLoginModal();
    return;
  }
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;

  const agreement = window.__tnc?.purchase || 'Dengan membeli Anda menyetujui Agreement.';

  showModal(`
    <h2>Beli ${product.name}</h2>
    <p style="color:#6c757d;font-size:0.9rem;margin-bottom:12px">${product.description || ''}</p>
    <form id="form-buy">
      <div class="form-group">
        <label>Nomor Tujuan / ID Pelanggan</label>
        <input type="text" name="customer_no" required placeholder="08xxxxxxxxxx atau ID">
      </div>
      <div class="form-group">
        <label>Metode Pembayaran</label>
        <select name="payment_method">
          <option value="qris">QRIS</option>
          <option value="va_bca">Virtual Account BCA</option>
          <option value="va_bri">Virtual Account BRI</option>
          <option value="va_mandiri">Virtual Account Mandiri</option>
          <option value="ewallet">E-Wallet</option>
        </select>
      </div>
      <div class="alert alert-info">
        Harga: ${product.price > 0 ? formatRupiah(product.price) : 'Sesuai inquiry'} + biaya layanan
      </div>
      <p style="font-size:0.8rem;color:#64748b;margin:8px 0">S&amp;K dan Agreement sudah disetujui di Profil.</p>
      <div id="buy-alert"></div>
      <button type="submit" class="btn btn-primary btn-block">Proses Pembelian</button>
    </form>
  `);

  $('#form-buy').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      user_id: user.id,
      product_id: productId,
      customer_no: fd.get('customer_no'),
      payment_method: fd.get('payment_method'),
      agreement_accepted: true
    };
    const alertBox = $('#buy-alert');
    try {
      const res = await fetch(`${API}/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (json.success) {
        const d = json.data;
        // Tutup form beli, tampilkan instruksi bayar
        const payHtml = `
          <h2 style="margin:0 0 12px">Menunggu Pembayaran</h2>
          <p style="font-size:0.9rem;color:#64748b">Selesaikan pembayaran via VA / QRIS. Setelah bayar, konfirmasi di bawah (simulasi) atau tunggu callback gateway.</p>
          <div class="alert alert-info" style="text-align:left">
            <strong>Ref:</strong> ${d.ref_id}<br>
            <strong>Total:</strong> Rp ${Number(d.total).toLocaleString('id-ID')}<br>
            ${d.va_number ? '<strong>Virtual Account:</strong> <code id="pay-va">' + d.va_number + '</code> ' + (d.va_bank||'') + '<br>' : ''}
            ${(d.qr_image || d.qr_string) ? '<strong style="display:block;margin-bottom:8px">Scan QRIS</strong><div style="text-align:center;background:#fff;padding:12px;border-radius:12px;border:1px solid #e2e8f0">' +
              (d.qr_image
                ? '<img src="' + d.qr_image + '" alt="QRIS" style="width:220px;height:220px;object-fit:contain;display:block;margin:0 auto">'
                : '<canvas id="qris-canvas" width="220" height="220" style="display:block;margin:0 auto"></canvas>') +
              '</div><details style="margin-top:8px"><summary style="cursor:pointer;font-size:0.8rem;color:#64748b">Kode QRIS (teks)</summary><code style="font-size:0.65rem;word-break:break-all">' + (d.qr_string||'') + '</code></details>' : ''}
            ${d.payment_url ? '<a href="' + d.payment_url + '" target="_blank" rel="noopener">Buka halaman pembayaran</a><br>' : ''}
            <strong>Status:</strong> ${d.status || 'waiting_payment'}
          </div>
          <button type="button" class="btn btn-outline btn-block" id="btn-copy-va" style="margin-bottom:8px">Salin VA / Ref</button>
          <button type="button" class="btn btn-primary btn-block" id="btn-sim-pay">Simulasi: Saya Sudah Bayar</button>
          <button type="button" class="btn btn-outline btn-block" id="btn-close-pay" style="margin-top:8px">Tutup</button>
          <div id="pay-result" style="margin-top:12px"></div>`;
        showModal(payHtml);
        document.getElementById('btn-copy-va')?.addEventListener('click', async () => {
          const text = (d.va_number || d.ref_id || '') + '';
          try { await navigator.clipboard.writeText(text); showToast('Disalin', 'success'); } catch(_){}
        });
        document.getElementById('btn-close-pay')?.addEventListener('click', () => {
          document.getElementById('modal-overlay')?.classList.add('hidden');
        });
        document.getElementById('btn-sim-pay')?.addEventListener('click', async () => {
          const user = getUser();
          const r = await fetch(API + '/order/confirm-payment', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ref_id: d.ref_id, user_id: user?.id })
          });
          const j2 = await r.json();
          const box = document.getElementById('pay-result');
          if (j2.success) {
            if (box) {
              box.innerHTML = '<div class="alert alert-success">' + j2.message + (j2.data && j2.data.sn ? '<br>SN: ' + j2.data.sn : '') + '</div><button type="button" class="btn btn-outline btn-block" id="btn-print-receipt">Cetak Struk</button>';
              document.getElementById('btn-print-receipt')?.addEventListener('click', () => {
                window.open('/api/receipt/' + d.ref_id + '?format=html', '_blank');
              });
            }
            showToast('Pembayaran berhasil', 'success');
          } else {
            if (box) box.innerHTML = '<div class="alert alert-error">' + (j2.message||'Gagal') + '</div>';
          }
        });
      } else {
        alertBox.innerHTML = `<div class="alert alert-error">${json.message}</div>`;
      }
    } catch {
      alertBox.innerHTML = `<div class="alert alert-error">Gagal terhubung ke server</div>`;
    }
  });
}

// ========== Transaction History ==========
async function openHistoryModal() {
  const user = getUser();
  if (!user) { openLoginModal(); return; }
  showModal(`<h2>Riwayat Transaksi</h2><div id="history-list"><p style="color:#6c757d">Memuat...</p></div>`);
  try {
    const res = await fetch(`${API}/user/${user.id}/transactions`);
    const json = await res.json();
    const list = json.data || [];
    if (list.length === 0) {
      $('#history-list').innerHTML = '<p style="color:#6c757d;text-align:center">Belum ada transaksi</p>';
      return;
    }
    $('#history-list').innerHTML = list.map(t => `
      <div style="border:1px solid #dee2e6;border-radius:8px;padding:12px;margin-bottom:10px;font-size:0.9rem">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <strong>${t.ref_id}</strong>
          <span class="badge ${t.status === 'success' ? 'badge-success' : 'badge-danger'}" style="padding:2px 8px;border-radius:4px;font-size:0.75rem;background:${t.status==='success'?'#d1e7dd':'#f8d7da'};color:${t.status==='success'?'#0f5132':'#842029'}">${t.status}</span>
        </div>
        <div>${t.product_name} → ${t.customer_no}</div>
        <div style="color:#6c757d">${formatRupiah(t.total)} · ${new Date(t.created_at).toLocaleString('id-ID')}</div>
        ${t.sn ? `<div style="font-size:0.8rem;margin-top:4px">SN: ${t.sn}</div>` : ''}
        <button class="btn btn-sm btn-outline" style="margin-top:8px" onclick="window.open('/api/receipt/${t.ref_id}?format=html','_blank')">Cetak Struk</button>
      </div>
    `).join('');
  } catch {
    $('#history-list').innerHTML = '<p class="alert alert-error">Gagal memuat riwayat</p>';
  }
}

// ========== Events ==========
document.addEventListener('DOMContentLoaded', () => {
  try { updateHeader(); } catch (e) { console.warn(e); }
  loadConfig().catch(console.warn);
  loadProducts().catch(console.warn);
  loadFaqs().catch(console.warn);
  try { renderTransferPanel(); } catch (e) { console.warn('transfer', e); }
  // Retry sekali jika grid masih kosong (race / cache lama)
  setTimeout(() => {
    const g = document.getElementById('products-grid');
    if (g && (!g.children.length || g.textContent.indexOf('Memuat') >= 0 || g.textContent.indexOf('Tidak ada') >= 0)) {
      loadProducts().catch(console.warn);
    }
    const tp = document.getElementById('transfer-panel');
    if (tp && !tp.innerHTML.trim()) {
      try { renderTransferPanel(); } catch (e) {}
    }
  }, 800);

  document.getElementById('btn-login')?.addEventListener('click', openLoginModal);
  document.getElementById('btn-register')?.addEventListener('click', openRegisterModal);
  document.getElementById('btn-logout')?.addEventListener('click', () => { setUser(null); });
  document.getElementById('modal-close')?.addEventListener('click', closeModal);
  document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderProducts(tab.dataset.cat);
    });
  });

  document.getElementById('menu-toggle')?.addEventListener('click', () => {
    const nav = document.getElementById('main-nav');
    if (nav) nav.classList.toggle('open');
  });

  // Bind static product cards (sebelum API selesai)
  document.querySelectorAll('#products-grid [data-product-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.getAttribute('data-product-id');
      if (typeof openBuyModal === 'function') openBuyModal(pid);
    });
  });

  document.getElementById('link-tnc')?.addEventListener('click', (e) => {
    e.preventDefault();
    showToast((window.__tnc && window.__tnc.registration) || 'Syarat & Ketentuan', 'info', 5000);
  });
});

// Expose for onclick
window.openBuyModal = openBuyModal;
window.openHistoryModal = openHistoryModal;

// ========== Profile berurutan: Email OTP → OCR KTP → GPS → Kelurahan → T&C → Agreement → Simpan ==========
async function openProfileModal() {
  const user = getUser();
  if (!user) { openLoginModal(); return; }
  showModal('<h2>Lengkapi Profil</h2><div id="profile-body"><p>Memuat...</p></div>');
  try {
    const res = await fetch(API + '/user/' + user.id + '/profile');
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    const d = json.data;
    const p = d.profile || {};
    const kycCfg = window.__kyc || {};
    // Ambil S&K / Agreement terbaru dari Backend Admin
    try {
      const cfg = await fetch(API + '/public/config').then(r => r.json());
      if (cfg.success && cfg.data && cfg.data.tnc) window.__tnc = cfg.data.tnc;
    } catch (_) {}
    const tncText = (window.__tnc && (window.__tnc.registration || window.__tnc.tnc)) || 'Syarat dan Ketentuan berlaku sesuai hukum Indonesia.';
    const agreeText = (window.__tnc && (window.__tnc.purchase || window.__tnc.agreement)) || 'Agreement Pengguna berlaku sesuai hukum Indonesia.';

    $('#profile-body').innerHTML = `
      <div style="font-size:0.8rem;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:6px">
        <span style="padding:2px 8px;border-radius:4px;background:${d.email_verified?'#d1e7dd':'#fff3cd'}">1. Email ${d.email_verified?'✓':'…'}</span>
        <span style="padding:2px 8px;border-radius:4px;background:${d.kyc_status==='approved'?'#d1e7dd':'#fff3cd'}">2. OCR KTP ${d.kyc_status==='approved'?'✓':'…'}</span>
        <span style="padding:2px 8px;border-radius:4px;background:${p.kecamatan?'#d1e7dd':'#fff3cd'}">3. GPS ${p.kecamatan?'✓':'…'}</span>
        <span style="padding:2px 8px;border-radius:4px;background:${d.tnc_accepted?'#d1e7dd':'#fff3cd'}">4. S&K ${d.tnc_accepted?'✓':'…'}</span>
        <span style="padding:2px 8px;border-radius:4px;background:${d.agreement_accepted?'#d1e7dd':'#fff3cd'}">5. Agreement ${d.agreement_accepted?'✓':'…'}</span>
      </div>

      <div class="profile-step" style="border:1px solid #c7d2fe;border-radius:10px;padding:12px;margin-bottom:12px;background:#eef2ff">
        <strong>🔐 PIN Transaksi (6 digit)</strong>
        <p style="font-size:0.8rem;color:#64748b;margin:6px 0 8px">Wajib untuk setiap pembelian / transfer. Status: <b id="pin-status-label">${d.pin_set ? 'Sudah diatur' : 'Belum diatur'}</b></p>
        <div class="form-group" id="pin-old-wrap" style="display:${d.pin_set ? 'block' : 'none'}">
          <label>PIN lama</label>
          <input type="password" id="prof-pin-old" maxlength="6" inputmode="numeric" pattern="[0-9]*" placeholder="••••••" autocomplete="off">
        </div>
        <div class="form-group">
          <label>PIN baru (6 digit)</label>
          <input type="password" id="prof-pin-new" maxlength="6" inputmode="numeric" pattern="[0-9]*" placeholder="••••••" autocomplete="off">
        </div>
        <div class="form-group">
          <label>Ulangi PIN baru</label>
          <input type="password" id="prof-pin-new2" maxlength="6" inputmode="numeric" pattern="[0-9]*" placeholder="••••••" autocomplete="off">
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="btn-save-pin">Simpan PIN</button>
        <div id="pin-save-msg" style="font-size:0.8rem;margin-top:6px"></div>
      </div>

      <!-- STEP 1: Email -->
      <div class="profile-step" style="border:1px solid #dee2e6;border-radius:10px;padding:12px;margin-bottom:12px">
        <strong>1. Email terdaftar (OTP)</strong>
        <div class="form-group" style="margin-top:8px">
          <label>Email</label>
          <input type="email" id="prof-email" value="${d.email||''}" ${d.email_verified && !d.profile_completed ? '' : ''}>
        </div>
        <p style="font-size:0.8rem;color:#6c757d">Status: ${d.email_verified ? 'Terverifikasi' : 'Belum verifikasi'}. Ubah email → kirim OTP ke email baru → verifikasi.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-outline btn-sm" id="btn-send-otp">Kirim OTP</button>
          <input type="text" id="otp-code" placeholder="Kode OTP" style="flex:1;min-width:100px;padding:8px;border:1px solid #ccc;border-radius:8px">
          <button type="button" class="btn btn-primary btn-sm" id="btn-verify-otp">Verifikasi</button>
        </div>
        <div id="otp-msg"></div>
      </div>

      <!-- STEP 2: Verifikasi KTP (OCR) -->
      <div id="step-kyc" class="profile-step">
        <strong>2. Verifikasi KTP</strong>
        <p style="font-size:0.8rem;color:#6c757d">1) Isi NIK &amp; Nama · 2) Pilih File dan Upload foto KTP · 3) Tekan Tombol Proses Verifikasi OCR. Pastikan Foto KTP: Tidak blur · Tidak ada Pantulan Sinar · Foto KTP dalam posisi Landscape (85,6 mm × 53,98 mm) rasio 1,586 : 1 (mendekati 8 : 5).</p>
        <div class="form-group"><label>NIK (16 digit)</label><input id="prof-nik" value="${p.nik||''}" maxlength="16" inputmode="numeric" placeholder="3515xxxxxxxxxxxx"></div>
        <div class="form-group"><label>Nama Sesuai KTP</label><input id="prof-nama" value="${p.nama_ktp||''}" placeholder="NAMA LENGKAP"></div>
        <div class="checkbox-group"><input type="checkbox" id="ocr-bypass"><label for="ocr-bypass">Lewati OCR — simpan manual (bukan verifikasi)</label></div>
        <div class="form-group"><label>Upload foto KTP</label><input type="file" id="ktp-file" accept="image/*" capture="environment"></div>
        <div id="kyc-file-status" style="font-size:0.8rem;color:#198754;display:none">✓ Foto KTP dipilih</div>
        <button type="button" class="btn btn-primary btn-block" id="btn-kyc">Proses Verifikasi OCR</button>
        <div id="kyc-msg"></div>

        <div class="form-group"><label>Nomor Telepon</label><input id="prof-phone" value="${p.phone||d.phone||''}" placeholder="08xxxxxxxxxx"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;justify-content:center">
          <button type="button" class="btn btn-outline" id="btn-send-otp-wa" style="min-width:140px;padding:12px 16px;font-size:0.95rem">OTP WhatsApp</button>
          <button type="button" class="btn btn-outline" id="btn-send-otp-sms" style="min-width:120px;padding:12px 16px;font-size:0.95rem">OTP SMS</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;justify-content:center;align-items:center">
          <input type="text" id="otp-phone-code" placeholder="Kode OTP" style="flex:1;min-width:120px;max-width:200px;padding:12px;border:1px solid #ccc;border-radius:8px;font-size:1rem;text-align:center">
          <button type="button" class="btn btn-primary" id="btn-verify-otp-phone" style="min-width:160px;padding:12px 24px;font-size:1rem;font-weight:600">Verifikasi</button>
        </div>
        <div id="otp-phone-msg"></div>
      </div>

      <!-- Profil Rekening (bukan di form daftar) -->
      <div class="profile-step" style="border:1px solid #dee2e6;border-radius:10px;padding:12px;margin-bottom:12px">
        <strong>Profil Rekening (untuk refund)</strong>
        <p style="font-size:0.8rem;color:#6c757d;margin:6px 0">Nama pengguna sudah dari pendaftaran. Lengkapi rekening di sini.</p>
        <div class="form-group"><label>Nama Pengguna</label><input id="prof-username" value="${d.username||''}" readonly style="background:#f1f3f5"></div>
        <div class="form-group"><label>No. Rekening</label><input id="prof-bank-account" value="${d.bank_account||''}" placeholder="1234567890"></div>
        <div class="form-group"><label>Bank</label><input id="prof-bank-name" value="${d.bank_name||''}" placeholder="BCA / BRI / Mandiri"></div>
        <div class="form-group"><label>Nama Pemilik Rekening</label>
          <div style="display:flex;gap:8px">
            <input id="prof-account-holder" value="${d.account_holder||''}" placeholder="Nama sesuai rekening" style="flex:1">
            <button type="button" class="btn btn-outline btn-sm" id="btn-bank-inquiry">Inquiry</button>
          </div>
          <p style="font-size:0.75rem;color:#6c757d;margin-top:4px">Inquiry nama rekening (jeda 3 menit per sesi)</p>
          <div id="bank-inq-msg"></div>
        </div>
      </div>

      <!-- STEP 3: GPS -->
      <div id="step-gps" class="profile-step" style="border:1px solid #dee2e6;border-radius:10px;padding:12px;margin-bottom:12px">
        <strong>3. Lokasi GPS (otomatis, tidak bisa ketik manual)</strong>
        <button type="button" class="btn btn-outline btn-block" id="btn-geo" style="margin-top:8px">Ambil / Perbarui Lokasi GPS</button>
        <button type="button" class="btn btn-outline btn-block" id="btn-geo-demo" style="margin-top:6px;font-size:0.85rem">Gunakan lokasi contoh (jika GPS diblokir browser)</button>
        <div id="geo-msg" style="font-size:0.8rem;color:#6c757d;margin:8px 0"></div>
        <div class="form-group"><label>Kecamatan</label><input id="prof-kecamatan" value="${p.kecamatan||''}" readonly style="background:#f1f3f5"></div>
        <div class="form-group"><label>Kota/Kabupaten</label><input id="prof-kota" value="${p.kota||''}" readonly style="background:#f1f3f5"></div>
        <div class="form-group"><label>Kode Pos</label><input id="prof-kodepos" value="${p.kode_pos||''}" readonly style="background:#f1f3f5"></div>
        <input type="hidden" id="prof-lat" value="${p.lat||''}">
        <input type="hidden" id="prof-lng" value="${p.lng||''}">
      </div>

      <!-- STEP 5: T&C -->
      <div class="profile-step" style="border:1px solid #dee2e6;border-radius:10px;padding:12px;margin-bottom:12px">
        <strong>5. Syarat & Ketentuan</strong>
        <div id="tnc-box" style="max-height:120px;overflow:auto;background:#f8f9fa;padding:10px;border-radius:8px;font-size:0.85rem;margin:8px 0;white-space:pre-wrap">${tncText.replace(/</g,'&lt;')}</div>
        <button type="button" class="btn btn-outline btn-block" id="btn-agree-tnc">${d.tnc_accepted ? '✓ Sudah disetujui (ketuk untuk setuju ulang)' : 'Saya sudah membaca & Setuju S&K'}</button>
        <input type="hidden" id="tnc-ok" value="${d.tnc_accepted?'1':''}">
      </div>

      <!-- STEP 6: Agreement -->
      <div class="profile-step" style="border:1px solid #dee2e6;border-radius:10px;padding:12px;margin-bottom:12px">
        <strong>6. Agreement Pengguna</strong>
        <div id="agree-box" style="max-height:120px;overflow:auto;background:#f8f9fa;padding:10px;border-radius:8px;font-size:0.85rem;margin:8px 0;white-space:pre-wrap">${agreeText.replace(/</g,'&lt;')}</div>
        <button type="button" class="btn btn-outline btn-block" id="btn-agree-agr">${d.agreement_accepted ? '✓ Sudah disetujui (ketuk untuk setuju ulang)' : 'Saya sudah membaca & Setuju Agreement'}</button>
        <input type="hidden" id="agr-ok" value="${d.agreement_accepted?'1':''}">
      </div>

      <!-- STEP 7: Simpan -->
      <button type="button" class="btn btn-success btn-block" id="btn-save-profile">7. Simpan Profil</button>
      <div id="profile-msg"></div>
    `;

    async function loadKelurahanOptions(kecamatan, selected) {
      const sel = $('#prof-kelurahan');
      if (!sel) return;
      sel.innerHTML = '<option value="">-- Pilih kelurahan --</option>';
      if (!kecamatan) return;
      try {
        const r = await fetch(API + '/geo/kelurahan?kecamatan=' + encodeURIComponent(kecamatan));
        const j = await r.json();
        (j.data?.kelurahan_list || []).forEach(name => {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          if (selected && selected === name) opt.selected = true;
          sel.appendChild(opt);
        });
        if (selected && !Array.from(sel.options).some(o => o.value === selected)) {
          const opt = document.createElement('option');
          opt.value = selected;
          opt.textContent = selected;
          opt.selected = true;
          sel.appendChild(opt);
        }
      } catch (e) {}
    }
    if (p.kecamatan) loadKelurahanOptions(p.kecamatan, p.kelurahan);

    // OTP
    $('#btn-send-otp')?.addEventListener('click', async () => {
      const email = ($('#prof-email').value || '').trim();
      if (!email) { $('#otp-msg').innerHTML = '<div class="alert alert-error">Isi email</div>'; return; }
      const r = await fetch(API+'/otp/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
      const j = await r.json();
      $('#otp-msg').innerHTML = '<div class="alert '+(j.success?'alert-success':'alert-error')+'">'+j.message+(j.data&&j.data.demo_otp?' · OTP: <b>'+j.data.demo_otp+'</b>':'')+'</div>';
    });
    $('#btn-verify-otp')?.addEventListener('click', async () => {
      const email = ($('#prof-email').value || '').trim();
      const code = ($('#otp-code').value || '').trim();
      const change = email.toLowerCase() !== (d.email || '').toLowerCase();
      const r = await fetch(API+'/otp/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email, code, user_id: user.id, change_email: change})});
      const j = await r.json();
      $('#otp-msg').innerHTML = '<div class="alert '+(j.success?'alert-success':'alert-error')+'">'+j.message+'</div>';
      if (j.success) {
        const u = getUser();
        u.email_verified = true;
        if (j.data?.email) { u.email = j.data.email; }
        setUser(u);
        setTimeout(openProfileModal, 700);
      }
    });

    
    // OTP WhatsApp / SMS ke nomor telepon
    async function sendPhoneOTP(channel) {
      const phone = ($('#prof-phone').value || '').replace(/[\s-]/g, '');
      if (!phone || phone.length < 10) { showToast('Isi nomor telepon valid', 'warn'); return; }
      const r = await fetch(API+'/otp/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone, channel})});
      const j = await r.json();
      $('#otp-phone-msg').innerHTML = '<div class="alert '+(j.success?'alert-success':'alert-error')+'">'+j.message+(j.data&&j.data.demo_otp?' · OTP: <b>'+j.data.demo_otp+'</b>':'')+'</div>';
      if (j.success) showToast('OTP '+channel+' dikirim', 'success');
      else showToast(j.message, 'error');
    }
    $('#btn-send-otp-wa')?.addEventListener('click', () => sendPhoneOTP('whatsapp'));
    $('#btn-send-otp-sms')?.addEventListener('click', () => sendPhoneOTP('sms'));
    $('#btn-verify-otp-phone')?.addEventListener('click', async () => {
      const phone = ($('#prof-phone').value || '').replace(/[\s-]/g, '');
      const code = ($('#otp-phone-code').value || '').trim();
      const r = await fetch(API+'/otp/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone, code, user_id: user.id})});
      const j = await r.json();
      $('#otp-phone-msg').innerHTML = '<div class="alert '+(j.success?'alert-success':'alert-error')+'">'+j.message+'</div>';
      if (j.success) {
        showToast('Telepon terverifikasi', 'success');
        const u = getUser(); u.phone = phone; setUser(u);
      }
    });

    // Inquiry nama pemilik rekening
    $('#btn-bank-inquiry')?.addEventListener('click', async () => {
      const bank = ($('#prof-bank-name').value || 'bca').toLowerCase().split(/[\s/]/)[0];
      const account = ($('#prof-bank-account').value || '').trim();
      if (!account) { showToast('Isi nomor rekening', 'warn'); return; }
      showToast('Inquiry rekening…', 'info');
      const r = await fetch(API+'/bank/inquiry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:user.id, bank_code: bank, account_number: account})});
      const j = await r.json();
      if (j.success) {
        $('#prof-account-holder').value = j.data.account_name || '';
        $('#bank-inq-msg').innerHTML = '<div class="alert alert-success">'+j.data.bank_name+' · '+j.data.account_name+(j.data.simulated?' (simulasi)':'')+'</div>';
        showToast('Inquiry berhasil', 'success');
      } else {
        $('#bank-inq-msg').innerHTML = '<div class="alert alert-error">'+j.message+'</div>';
        showToast(j.message, 'error', 5000);
      }
    });

// OCR KTP (Tesseract.js + server)
    
    $('#ocr-bypass')?.addEventListener('change', () => {
      const on = $('#ocr-bypass').checked;
      if (on) showToast('Mode lewati OCR: isi Nama & NIK manual', 'info');
    });

    $('#btn-kyc')?.addEventListener('click', async () => {
      const bypass = $('#ocr-bypass')?.checked;
      const userNik = ($('#prof-nik')?.value || '').replace(/\D/g, '');
      const userNama = ($('#prof-nama')?.value || '').trim().toUpperCase();

      if (bypass) {
        if (userNama.length < 3 || userNik.length !== 16) {
          showToast('Isi Nama dan NIK 16 digit untuk lewati OCR', 'warn');
          return;
        }
        const r = await fetch(API+'/kyc/submit', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ user_id: user.id, bypass: true, hint: { nama_ktp: userNama, nik: userNik } })
        });
        const j = await r.json();
        $('#kyc-msg').innerHTML = '<div class="alert alert-info">' +
          (j.message || 'OCR dilewati — data manual, belum terverifikasi.') + '</div>';
        if (j.success) {
          const u = getUser();
          u.kyc_status = 'pending';
          u.profile = Object.assign({}, u.profile||{}, { nama_ktp: userNama, nik: userNik });
          setUser(u);
          ['prof-nik','prof-nama'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.readOnly = false; el.style.background = '#fff3cd'; delete el.dataset.locked; }
          });
          showToast('Disimpan manual — belum terverifikasi OCR', 'warn', 5000);
        }
        return;
      }

      if (userNik.length !== 16) { showToast('Isi NIK 16 digit terlebih dahulu', 'warn'); return; }
      if (userNama.length < 3) { showToast('Isi Nama sesuai KTP terlebih dahulu', 'warn'); return; }
      const file = $('#ktp-file')?.files?.[0];
      if (!file) {
        $('#kyc-msg').innerHTML = '<div class="alert alert-error">Upload foto KTP</div>';
        return;
      }

      // Verifikasi ulang selalu buka kunci NIK & Nama
      ['prof-nik','prof-nama'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.readOnly = false; el.style.background = ''; delete el.dataset.locked; }
      });

      const reader = new FileReader();
      reader.onload = async () => {
        let nikUpscale = null, namaUpscale = null, adminProcessed = null;
        let ocrNik = '', ocrNama = '', nikText = '', namaText = '';

        try {
          // Proses 1: Upload Ulang
          $('#kyc-msg').innerHTML = '<div class="alert alert-info"><strong>Proses 1/4</strong> Upload Ulang (Sharp)…</div>';
          showToast('Proses 1: Validasi upload…', 'info', 2500);

          const r1 = await fetch(API + '/kyc/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_id: user.id,
              imageBase64: reader.result,
              filename: file.name,
              hint: { nik: userNik, nama_ktp: userNama },
              ocr_text: ''
            })
          });
          const j1 = await r1.json();
          const failCodes = ['BLUR_TOO_HIGH','ANTIFAKE_FAIL','REFLECTION','THIN_PRINT','EDITED_SOFTWARE','INVALID_IMAGE','NO_IMAGE','WATERMARK_DETECTED'];
          if ((!j1.success && j1.data && failCodes.includes(j1.data.code)) ||
              (!r1.ok && !j1.success && !(j1.data && (j1.data.nik_upscale_image || j1.data.processed_image)))) {
            $('#kyc-msg').innerHTML = '<div class="alert alert-error"><strong>Proses 1 gagal</strong> — ' + (j1.message || 'Upload ulang') + '</div>';
            showToast(j1.message || 'Upload ulang', 'error', 6000);
            return;
          }

          nikUpscale = (j1.data && j1.data.nik_upscale_image) || null;
          namaUpscale = (j1.data && (j1.data.nama_upscale_image || j1.data.verify_image)) || null;
          adminProcessed = (j1.data && j1.data.processed_image) || null;

          // Proses 2: Verifikasi NIK (foto upload)
          $('#kyc-msg').innerHTML = '<div class="alert alert-info"><strong>Proses 2/4</strong> Verifikasi NIK…</div>';
          showToast('Proses 2: OCR NIK…', 'info', 2500);
          if (window.KtpOcr && window.Tesseract) {
            const srcNik = nikUpscale || reader.result;
            const nikRes = await KtpOcr.recognizeNik(srcNik, (pct) => {
              $('#kyc-msg').innerHTML = '<div class="alert alert-info"><strong>Proses 2/4</strong> OCR NIK ' + pct + '%</div>';
            });
            ocrNik = nikRes.nik || '';
            nikText = nikRes.ocrText || '';
          }
          nikUpscale = null;

          // Proses 3: Rekayasa Foto (sudah di server)
          $('#kyc-msg').innerHTML = '<div class="alert alert-info"><strong>Proses 3/4</strong> Rekayasa Foto — arsip admin & sumber Nama.</div>';
          showToast('Proses 3: Rekayasa foto…', 'info', 2000);
          await new Promise(r => setTimeout(r, 300));

          // Proses 4: Verifikasi Nama (Foto Hasil Rekayasa)
          $('#kyc-msg').innerHTML = '<div class="alert alert-info"><strong>Proses 4/4</strong> Verifikasi Nama…</div>';
          showToast('Proses 4: OCR Nama…', 'info', 2500);
          if (window.KtpOcr && window.Tesseract) {
            const srcNama = namaUpscale || reader.result; // jangan pakai adminProcessed (watermark)
            const namaRes = await KtpOcr.recognizeNama(srcNama, (pct) => {
              $('#kyc-msg').innerHTML = '<div class="alert alert-info"><strong>Proses 4/4</strong> OCR Nama ' + pct + '%</div>';
            });
            ocrNama = namaRes.nama_ktp || '';
            namaText = namaRes.ocrText || '';
          }
          namaUpscale = null;

          // Submit matching
          const r2 = await fetch(API + '/kyc/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_id: user.id,
              imageBase64: reader.result,
              filename: file.name,
              hint: { nik: userNik, nama_ktp: userNama, ocr_nik: ocrNik, ocr_nama: ocrNama },
              ocr_text: (nikText + '\n' + namaText).slice(0, 8000),
              engineeredDataUrl: adminProcessed
            })
          });
          const j = await r2.json();
          const o = (j.data && j.data.ocr) || {};
          const lockNik = !!(j.data && j.data.lock_nik) || !!o.nik_match;
          const lockNama = !!(j.data && j.data.lock_nama) || !!o.nama_match;
          const nikScore = o.nik_score != null ? o.nik_score : 0;
          const namaScore = o.nama_score != null ? o.nama_score : 0;
          const bothOk = lockNik && lockNama;

          $('#kyc-msg').innerHTML =
            '<div class="alert ' + (j.success ? 'alert-success' : 'alert-error') + '">' +
            '<div><strong>Proses 1</strong> Upload Ulang ✓</div>' +
            '<div><strong>Proses 2</strong> NIK: OCR <code>' + (ocrNik || '—') + '</code> · match <strong>' + nikScore + '%</strong> ' + (lockNik ? '✓ terkunci' : '✗') + '</div>' +
            '<div><strong>Proses 3</strong> Rekayasa Foto ✓ (arsip admin)</div>' +
            '<div><strong>Proses 4</strong> Nama: OCR <code>' + (ocrNama || '—') + '</code> · match <strong>' + namaScore + '%</strong> ' + (lockNama ? '✓ terkunci' : '✗') + '</div>' +
            (bothOk
              ? '<div style="margin-top:8px"><strong>NIK &amp; Nama terverifikasi (≥50%)</strong></div>'
              : '<div style="margin-top:8px">Jalankan Proses Verifikasi OCR ulang untuk memverifikasi ulang NIK dan Nama.</div>') +
            '</div>';

          // Per-field lock: ≥50% → field itu terkunci
          const elN = document.getElementById('prof-nik');
          const elM = document.getElementById('prof-nama');
          if (elN) {
            if (lockNik) { elN.readOnly = true; elN.style.background = '#e8f5e9'; elN.dataset.locked = '1'; }
            else { elN.readOnly = false; elN.style.background = '#fff3cd'; delete elN.dataset.locked; }
          }
          if (elM) {
            if (lockNama) { elM.readOnly = true; elM.style.background = '#e8f5e9'; elM.dataset.locked = '1'; }
            else { elM.readOnly = false; elM.style.background = '#fff3cd'; delete elM.dataset.locked; }
          }

          if (j.success || lockNik || lockNama) {
            const u = getUser();
            u.kyc_status = bothOk ? 'approved' : 'pending';
            u.has_ktp = true;
            u.profile = Object.assign({}, u.profile || {}, { nama_ktp: userNama, nik: userNik });
            setUser(u);
            showToast(bothOk ? 'NIK & Nama terverifikasi' : 'Partial — verifikasi ulang jika perlu', bothOk ? 'success' : 'warn', 5000);
          } else if (!j.success) {
            showToast(j.message || 'Verifikasi gagal', 'error', 6000);
          }
        } catch (err) {
          console.error(err);
          $('#kyc-msg').innerHTML = '<div class="alert alert-error">Gagal: ' + (err.message || err) + '</div>';
          showToast('Gagal proses OCR', 'error');
        }
      };
      reader.readAsDataURL(file);
    });

function lockGeoFields() {
      ['prof-kecamatan','prof-kota','prof-kodepos'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.readOnly = true; el.style.background = '#f1f3f5'; el.tabIndex = -1; }
      });
    }
    lockGeoFields();
    async function applyGeoData(j, lat, lng) {
      $('#prof-kecamatan').value = j.data.kecamatan || '';
      $('#prof-kota').value = j.data.kota || '';
      $('#prof-kodepos').value = j.data.kode_pos || '';
      if (lat != null) $('#prof-lat').value = lat;
      if (lng != null) $('#prof-lng').value = lng;
      lockGeoFields();
      await loadKelurahanOptions(j.data.kecamatan, '');
    }
    $('#btn-geo-demo')?.addEventListener('click', async () => {
      // Jakarta Selatan contoh
      const lat = -6.2615, lng = 106.8106;
      showToast('Mengisi lokasi contoh…', 'info');
      try {
        const r = await fetch(API+'/geo/reverse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat,lng})});
        const j = await r.json();
        if (j.success) {
          await applyGeoData(j, lat, lng);
          $('#geo-msg').textContent = (j.data.display_name || 'Lokasi contoh') + ' — field tidak dapat diedit manual';
          showToast('Lokasi contoh terisi (readonly)', 'success');
        } else showToast(j.message || 'Gagal', 'error');
      } catch (e) { showToast('Gagal lokasi contoh', 'error'); }
    });


// GPS — selalu bisa dipakai; hasil readonly (tidak bisa diketik manual)
    $('#btn-geo')?.addEventListener('click', () => {
      const msg = $('#geo-msg');
      if (!navigator.geolocation) {
        if (msg) msg.textContent = 'GPS tidak didukung. Gunakan HTTPS + Chrome/Safari.';
        showToast('GPS tidak didukung browser', 'error');
        return;
      }
      if (msg) msg.textContent = 'Meminta izin lokasi… Izinkan akses lokasi di browser.';
      showToast('Mengambil lokasi GPS…', 'info', 2500);
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        if (msg) msg.textContent = 'Koordinat: ' + lat.toFixed(5) + ', ' + lng.toFixed(5) + ' — memproses…';
        try {
          const r = await fetch(API+'/geo/reverse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat,lng})});
          const j = await r.json();
          if (j.success) {
            await applyGeoData(j, lat, lng);
            if (msg) msg.textContent = (j.data.display_name || 'Lokasi terisi') + ' [' + j.data.source + '] — tidak dapat diedit manual';
            showToast('Lokasi GPS berhasil', 'success');
          } else {
            if (msg) msg.textContent = j.message || 'Gagal reverse geocode';
            showToast(j.message || 'Gagal lokasi', 'error');
          }
        } catch (err) {
          if (msg) msg.textContent = 'Gagal koneksi: ' + (err.message || '');
          showToast('Gagal memproses lokasi', 'error');
        }
      }, (err) => {
        const map = { 1: 'Izin lokasi ditolak. Aktifkan di pengaturan browser/situs (ikon gembok → Izinkan lokasi).', 2: 'Posisi tidak tersedia.', 3: 'Timeout GPS. Coba di area terbuka.' };
        const m = map[err && err.code] || ('GPS error: ' + ((err && err.message) || ''));
        if (msg) msg.textContent = m;
        showToast(m, 'error', 6000);
      }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    });


    // T&C & Agreement — harus baca (scroll) opsional, wajib ketuk setuju
    $('#btn-agree-tnc')?.addEventListener('click', () => {
      $('#tnc-ok').value = '1';
      $('#btn-agree-tnc').textContent = '✓ S&K disetujui';
      $('#btn-agree-tnc').classList.add('btn-success');
    });
    $('#btn-agree-agr')?.addEventListener('click', () => {
      $('#agr-ok').value = '1';
      $('#btn-agree-agr').textContent = '✓ Agreement disetujui';
      $('#btn-agree-agr').classList.add('btn-success');
    });

    // Simpan
    $('#btn-save-profile')?.addEventListener('click', async () => {
      const body = {
        nama_ktp: $('#prof-nama').value.trim(),
        nik: $('#prof-nik').value.trim(),
        phone: $('#prof-phone').value.trim(),
        bank_account: $('#prof-bank-account')?.value?.trim() || '',
        bank_name: $('#prof-bank-name')?.value?.trim() || '',
        account_holder: $('#prof-account-holder')?.value?.trim() || '',
        kecamatan: $('#prof-kecamatan').value.trim(),
        kota: $('#prof-kota').value.trim(),
        kode_pos: $('#prof-kodepos').value.trim(),
                lat: $('#prof-lat').value ? Number($('#prof-lat').value) : undefined,
        lng: $('#prof-lng').value ? Number($('#prof-lng').value) : undefined,
        tnc_accepted: $('#tnc-ok').value === '1',
        agreement_accepted: $('#agr-ok').value === '1'
      };
      const r = await fetch(API+'/user/'+user.id+'/profile',{
        method:'PUT',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(body)
      });
      const j = await r.json();
      $('#profile-msg').innerHTML = '<div class="alert '+(j.success?'alert-success':'alert-error')+'">'+(j.success ? (j.message||'Profil disimpan') : j.message)+'</div>';
      if (j.success) {
        const u = getUser();
        u.profile = j.data.profile;
        u.tnc_accepted = true;
        u.agreement_accepted = true;
        u.profile_completed = true;
        u.kyc_status = 'approved';
        setUser(u);
        setTimeout(() => { closeModal(); }, 1200);
      }
    });
  } catch (err) {
    $('#profile-body').innerHTML = '<div class="alert alert-error">'+(err.message||'Gagal memuat profil')+'</div>';
  }
}

const __origBuy = openBuyModal;
openBuyModal = async function(productId) {
  const user = getUser();
  if (!user) { openLoginModal(); return; }
  // Hanya profil yang sudah terverifikasi (lengkap) yang boleh beli
  if (!user.profile_completed) {
    showToast('Lengkapi dan simpan Profil terlebih dahulu sebelum pembelian.', 'warn');
    openProfileModal();
    return;
  }
  if ((window.__kyc||{}).required_for_purchase && user.kyc_status !== 'approved') {
    showToast('Lengkapi KYC (OCR KTP) di Profil sebelum membeli.', 'warn');
    openProfileModal();
    return;
  }
  if (user.email_verified === false) {
    showToast('Verifikasi email OTP di Profil terlebih dahulu.', 'warn');
    openProfileModal();
    return;
  }
  await __origBuy(productId);
  try {
    const r = await fetch(API+'/cart/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({product_id:productId})});
    const j = await r.json();
    if (j.success) {
      const box = document.querySelector('#form-buy .alert-info');
      if (box) {
        const fl=(j.data.fee_lines||[]).map(x=>x.name+': '+formatRupiah(x.amount)).join('<br>')||'-';
        const tl=(j.data.tax_lines||[]).map(x=>x.name+': '+formatRupiah(x.amount)).join('<br>')||'-';
        box.innerHTML =
          '<div style="font-weight:700;margin-bottom:8px">Keranjang</div>' +
          '<div style="border-bottom:1px solid #cfe2ff;padding:4px 0;display:flex;justify-content:space-between"><span>Harga</span><span>'+formatRupiah(j.data.product.price)+'</span></div>' +
          '<div style="margin-top:8px;font-size:0.8rem;color:#64748b;font-weight:600">Biaya</div>' +
          '<div style="padding:4px 0">'+fl+'</div>' +
          '<div style="margin-top:8px;font-size:0.8rem;color:#64748b;font-weight:600">Pajak (atas biaya layanan)</div>' +
          '<div style="padding:4px 0">'+tl+'</div>' +
          '<div style="border-top:2px solid #0d6efd;margin-top:8px;padding-top:8px;display:flex;justify-content:space-between;font-weight:700"><span>Total</span><span>'+formatRupiah(j.data.total)+'</span></div>';
      }
    }
  } catch(e) {}
};

window.openBuyModal = openBuyModal;
window.openHistoryModal = openHistoryModal;
window.openProfileModal = openProfileModal;


function calcTransferFees(amount) {
  const fees = (window.__fees && (window.__fees.transfer || window.__fees.domestic)) || {};
  const items = fees.items || [
    { name: 'Biaya Admin', type: 'fixed', value: 500, active: true },
    { name: 'Biaya Layanan', type: 'percent', value: 1, active: true }
  ];
  let total = 0;
  const lines = [];
  items.filter(i => i.active !== false).forEach(it => {
    let a = 0;
    if (it.type === 'percent') a = Math.round(amount * (Number(it.value) || 0) / 100);
    else a = Number(it.value) || 0;
    total += a;
    lines.push({ name: it.name, amount: a });
  });
  // Pajak hanya atas biaya layanan
  const taxes = (window.__taxes && (window.__taxes.items || window.__taxes)) || [];
  const taxList = Array.isArray(taxes) ? taxes : [];
  let tax = 0;
  const taxLines = [];
  taxList.filter(i => i && i.active !== false).forEach(it => {
    let a = it.type === 'percent' ? Math.round(total * (Number(it.value) || 0) / 100) : Number(it.value) || 0;
    tax += a;
    taxLines.push({ name: it.name || 'Pajak', amount: a });
  });
  return { lines, total, taxLines, tax, grand: amount + total + tax };
}

// ========== Domestic Transfer Request ==========
function renderTransferPanel() {
  const el = document.getElementById('transfer-panel');
  if (!el) return;
  el.innerHTML = `
    <div class="tr-form-stack">
      <div class="tr-form-card">
        <h3 class="tr-form-title">Buat Transfer Order</h3>
        <div class="form-group"><label>Bank Tujuan</label>
          <select id="tr-bank" class="bank-select preferred-bank-select">
            <optgroup label="⭐ Preferred">
              <option value="bni">★ BNI — Preferred</option>
              <option value="permata">★ Permata — Preferred</option>
            </optgroup>
            <optgroup label="Bank lainnya">
              <option value="bca">BCA</option>
              <option value="bri">BRI</option>
              <option value="mandiri">Mandiri</option>
              <option value="cimb">CIMB Niaga</option>
            </optgroup>
          </select>
        </div>
        <div class="form-group"><label>No. Rekening Tujuan</label>
          <input id="tr-account" placeholder="Nomor rekening">
        </div>
        <button type="button" class="btn btn-outline btn-block" id="tr-inquiry">Inquiry Rekening (bdPay)</button>
        <div id="tr-inquiry-result" style="margin:8px 0;font-size:0.9rem"></div>
        <div class="form-group"><label>Nominal (Rp)</label>
          <input id="tr-amount" type="text" data-currency inputmode="numeric" autocomplete="off" placeholder="100.000">
        </div>
        <div id="tr-fee-box" class="tr-fee-box">
          <strong>Biaya Layanan Domestic Transfer</strong>
          <div id="tr-fee-lines" style="margin-top:6px;color:#64748b">Isi nominal untuk hitung biaya…</div>
          <div id="tr-fee-total" style="margin-top:6px;font-weight:600"></div>
        </div>
        <div class="form-group"><label>Jangka Waktu Virtual Account</label>
          <select id="tr-duration">
            <option value="5">5 menit</option>
            <option value="60">1 jam</option>
          </select>
        </div>
        <button type="button" class="btn btn-primary btn-block" id="tr-create">Terbitkan VA & Transfer Order</button>
        <div id="tr-create-result"></div>
      </div>
      <div style="border:1px solid #dee2e6;border-radius:12px;padding:16px;background:#fff">
        <h3 style="margin:0 0 12px;font-size:1rem">Cek Status Transfer Order</h3>
        <div class="form-group"><label>Nomor Transfer Order</label>
          <input id="tr-order-no" placeholder="TO-..." style="width:100%;padding:10px;border-radius:8px;border:1px solid #ccc">
        </div>
        <button type="button" class="btn btn-outline btn-block" id="tr-status">Cek Status</button>
        <div id="tr-status-result"></div>
      </div>
    </div>`;

  
  document.getElementById('tr-amount')?.addEventListener('input', () => {
    const elAmt = document.getElementById('tr-amount');
    if (elAmt) {
      const digits = String(elAmt.value).replace(/[^0-9]/g, '').slice(0, 15);
      elAmt.value = digits ? Number(digits).toLocaleString('id-ID') : '';
      try { const len = elAmt.value.length; elAmt.setSelectionRange(len, len); } catch (_) {}
    }
    const amount = parseIdr(document.getElementById('tr-amount')?.value) || 0
    const { lines, total, taxLines, tax, grand } = calcTransferFees(amount);
    const fl = document.getElementById('tr-fee-lines');
    const ft = document.getElementById('tr-fee-total');
    if (fl) fl.innerHTML = amount > 0
      ? ('<div style="font-weight:600">Biaya</div>' + lines.map(l => l.name + ': Rp ' + l.amount.toLocaleString('id-ID')).join('<br>') +
         (taxLines && taxLines.length ? '<div style="font-weight:600;margin-top:6px">Pajak (atas biaya)</div>' + taxLines.map(l => l.name + ': Rp ' + l.amount.toLocaleString('id-ID')).join('<br>') : ''))
      : 'Isi nominal untuk hitung biaya…';
    if (ft) ft.textContent = amount > 0
      ? 'Total bayar VA: Rp ' + grand.toLocaleString('id-ID') + ' (nominal + biaya + pajak)'
      : '';
  });

  document.getElementById('tr-inquiry')?.addEventListener('click', async () => {
    const user = getUser();
    if (!user) { openLoginModal(); showToast('Login dulu', 'warn'); return; }
    const bank = document.getElementById('tr-bank').value;
    const account = document.getElementById('tr-account').value.trim();
    if (!account) { showToast('Isi nomor rekening', 'warn'); return; }
    showToast('Inquiry rekening…', 'info');
    const r = await fetch(API + '/transfer/inquiry', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bank_code: bank, account_number: account, user_id: user.id })
    });
    const j = await r.json();
    const box = document.getElementById('tr-inquiry-result');
    if (j.success) {
      box.innerHTML = '<div class="alert alert-success">Bank: <b>' + j.data.bank_name + '</b><br>Rek: ' + j.data.account_number + '<br>Nama: <b>' + j.data.account_name + '</b>' + (j.data.simulated ? ' <small>(simulasi)</small>' : '') + '</div>';
      window.__trInquiry = j.data;
      showToast('Inquiry berhasil', 'success');
    } else {
      box.innerHTML = '<div class="alert alert-error">' + j.message + '</div>';
      showToast(j.message, 'error');
    }
  });

  document.getElementById('tr-create')?.addEventListener('click', async () => {
    const user = getUser();
    if (!user) { openLoginModal(); return; }
    if (!user.profile_completed) { showToast('Lengkapi Profil dulu', 'warn'); openProfileModal(); return; }
    const inq = window.__trInquiry;
    if (!inq) { showToast('Lakukan inquiry rekening dulu', 'warn'); return; }
    const amount = parseIdr(document.getElementById('tr-amount').value);
    const dur = Number(document.getElementById('tr-duration').value);
    if (!amount || amount < 10000) { showToast('Nominal minimal Rp 10.000', 'warn'); return; }
    showToast('Menerbitkan Virtual Account…', 'info');
    const r = await fetch(API + '/transfer/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: user.id,
        bank_code: inq.bank_code,
        account_number: inq.account_number,
        account_name: inq.account_name,
        amount,
        va_duration: dur
      })
    });
    const j = await r.json();
    const box = document.getElementById('tr-create-result');
    if (j.success) {
      const d = j.data;
      const base = d.base_amount != null ? d.base_amount : d.amount;
      const fee = d.fee != null ? d.fee : 0;
      const payAmt = d.amount != null ? d.amount : (Number(base) + Number(fee));
      const feeHtml = (d.fee_lines || []).map(x => x.name + ': Rp ' + Number(x.amount).toLocaleString('id-ID')).join('<br>');
      const taxHtml = (d.tax_lines || []).map(x => x.name + ': Rp ' + Number(x.amount).toLocaleString('id-ID')).join('<br>');
      const taxSum = d.tax != null ? Number(d.tax) : (d.tax_lines || []).reduce((s,x)=>s+Number(x.amount||0),0);
      const shareText = 'bdPay Transfer\nOrder: ' + d.order_no + '\nVA: ' + d.va_number + '\nBayar VA: Rp ' + Number(payAmt).toLocaleString('id-ID') + '\nBerlaku: ' + d.va_duration_minutes + ' menit';
      box.innerHTML = '<div class="alert alert-success" id="tr-result-card">' +
        '<strong>Transfer Order:</strong> <span id="tr-res-order">' + d.order_no + '</span><br>' +
        '<strong>VA:</strong> <span id="tr-res-va">' + d.va_number + '</span><br>' +
        'Nominal transfer: Rp ' + Number(base).toLocaleString('id-ID') + '<br>' +
        (feeHtml ? feeHtml + '<br>' : '') +
        (taxHtml ? '<span style="color:#64748b">Pajak (atas biaya)</span><br>' + taxHtml + '<br>' : (taxSum ? 'Pajak: Rp ' + taxSum.toLocaleString('id-ID') + '<br>' : '')) +
        '<strong>Total bayar VA: Rp ' + Number(payAmt).toLocaleString('id-ID') + '</strong><br>' +
        'Berlaku: ' + d.va_duration_minutes + ' menit<br>Status: ' + d.status +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' +
        '<button type="button" class="btn btn-outline btn-sm" id="tr-copy-all">Salin & Bagikan</button>' +
        '<button type="button" class="btn btn-outline btn-sm" id="tr-copy-va">Salin VA</button>' +
        '<button type="button" class="btn btn-outline btn-sm" id="tr-copy-order">Salin Order</button>' +
        '</div>' +
        '<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:600">Panduan Bayar VA (Mobile Banking & ATM)</summary>' +
        '<ol style="margin:8px 0 0 18px;font-size:0.85rem;line-height:1.5">' +
        '<li><b>Mobile Banking:</b> Buka aplikasi bank → Transfer / Bayar → Virtual Account → masukkan nomor VA → nominal harus sesuai → konfirmasi.</li>' +
        '<li><b>ATM:</b> Masukkan kartu → PIN → Transfer / Pembayaran → Virtual Account → input nomor VA → pastikan nominal → ya.</li>' +
        '<li>Simpan bukti bayar. Cek status dengan Nomor Transfer Order di form bawah.</li>' +
        '<li>Jangan transfer ke rekening biasa; gunakan menu Virtual Account agar status terverifikasi otomatis.</li>' +
        '</ol></details></div>';
      document.getElementById('tr-order-no').value = d.order_no;
      const copy = async (text, label) => {
        try { await navigator.clipboard.writeText(text); showToast(label + ' disalin', 'success'); }
        catch { showToast('Gagal salin', 'error'); }
      };
      document.getElementById('tr-copy-va')?.addEventListener('click', () => copy(String(d.va_number), 'VA'));
      document.getElementById('tr-copy-order')?.addEventListener('click', () => copy(String(d.order_no), 'Order'));
      document.getElementById('tr-copy-all')?.addEventListener('click', async () => {
        await copy(shareText, 'Info transfer');
        if (navigator.share) {
          try { await navigator.share({ title: 'bdPay VA', text: shareText }); } catch (_) {}
        }
      });
      showToast('VA diterbitkan: ' + d.order_no, 'success', 5000);
    } else {
      box.innerHTML = '<div class="alert alert-error">' + j.message + '</div>';
      showToast(j.message, 'error');
    }
  });

  document.getElementById('tr-status')?.addEventListener('click', async () => {
    const order_no = document.getElementById('tr-order-no').value.trim();
    if (!order_no) { showToast('Isi Nomor Transfer Order', 'warn'); return; }
    const r = await fetch(API + '/transfer/status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_no })
    });
    const j = await r.json();
    const box = document.getElementById('tr-status-result');
    if (j.success) {
      const d = j.data;
      const stFee = (d.fee_lines || []).map(x => x.name + ': Rp ' + Number(x.amount).toLocaleString('id-ID')).join('<br>');
      const stTax = (d.tax_lines || []).map(x => x.name + ': Rp ' + Number(x.amount).toLocaleString('id-ID')).join('<br>');
      box.innerHTML = '<div class="alert alert-info"><b>' + d.order_no + '</b><br>Status: <strong>' + d.status + '</strong><br>VA: ' + d.va_number +
        '<br>Nominal transfer: Rp ' + Number(d.base_amount != null ? d.base_amount : d.amount).toLocaleString('id-ID') +
        (stFee ? '<br>' + stFee : '<br>Biaya: Rp ' + Number(d.fee || 0).toLocaleString('id-ID')) +
        (stTax ? '<br><span style="opacity:.85">Pajak (atas biaya)</span><br>' + stTax : (d.tax ? '<br>Pajak: Rp ' + Number(d.tax).toLocaleString('id-ID') : '')) +
        '<br><strong>Total bayar VA: Rp ' + Number(d.amount).toLocaleString('id-ID') + '</strong>' +
        '<br>Tujuan: ' + d.bank_code + ' ' + d.account_number + ' (' + (d.account_name || '-') + ')' +
        '<br>Expired: ' + (d.expires_at || '-') + '</div>';
      showToast('Status: ' + d.status, 'info');
    } else {
      box.innerHTML = '<div class="alert alert-error">' + j.message + '</div>';
      showToast(j.message, 'error');
    }
  });
}

/* transfer panel di-init dari DOMContentLoaded utama */



/** Format ribuan IDR dinamis di Frontend */
function parseIdr(val) {
  if (val == null || val === '') return 0;
  const n = String(val).replace(/[^\d]/g, '');
  return n ? Number(n) : 0;
}
function formatIdrInput(val) {
  const n = parseIdr(val);
  return n ? n.toLocaleString('id-ID') : '';
}
function bindCurrencyInputsFrontend(root) {
  const scope = root || document;
  scope.querySelectorAll('#tr-amount, input[data-currency], input[id*="amount"], input[id*="price"]').forEach(el => {
    if (el.dataset.idrBound === '1') return;
    el.dataset.idrBound = '1';
    if (el.type === 'number') { try { el.type = 'text'; } catch (_) {} }
    el.setAttribute('inputmode', 'numeric');
    el.setAttribute('autocomplete', 'off');
    el.addEventListener('input', () => {
      const digits = String(el.value).replace(/[^0-9]/g, '').slice(0, 15);
      el.value = digits ? Number(digits).toLocaleString('id-ID') : '';
      try { const len = el.value.length; el.setSelectionRange(len, len); } catch (_) {}
    });
    el.addEventListener('blur', () => {
      const n = parseIdr(el.value);
      el.value = n ? formatIdrInput(n) : '';
    });
  });
}
window.parseIdr = parseIdr;
window.formatIdrInput = formatIdrInput;
document.addEventListener('DOMContentLoaded', () => bindCurrencyInputsFrontend());


// Gate PIN on sensitive API paths
(function(){
  const nativeFetch = window.fetch.bind(window);
  const PIN_PATHS = ['/api/purchase', '/api/transfer', '/api/orders', '/api/ppob'];
  window.fetch = async function(input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = ((init && init.method) || 'GET').toUpperCase();
      if (method !== 'GET' && PIN_PATHS.some(p => url.includes(p)) && window.getUser && getUser()) {
        if (typeof ensureTxPin === 'function') {
          const ok = await ensureTxPin();
          if (!ok) return new Response(JSON.stringify({ success: false, message: 'PIN dibatalkan' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
      }
    } catch (_) {}
    return nativeFetch(input, init);
  };
})();


document.addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'btn-save-pin') {
    e.preventDefault();
    const user = getUser();
    if (!user) return;
    const oldPin = document.getElementById('prof-pin-old')?.value || '';
    const pin = document.getElementById('prof-pin-new')?.value || '';
    const pin2 = document.getElementById('prof-pin-new2')?.value || '';
    const msg = document.getElementById('pin-save-msg');
    if (!/^\d{6}$/.test(pin)) { if (msg) msg.innerHTML = '<span style="color:#e11d48">PIN harus 6 digit angka</span>'; return; }
    if (pin !== pin2) { if (msg) msg.innerHTML = '<span style="color:#e11d48">PIN baru tidak sama</span>'; return; }
    try {
      const r = await fetch(API + '/pin/set', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, pin, old_pin: oldPin || undefined })
      });
      const j = await r.json();
      if (j.success) {
        user.pin_set = true;
        setUser(user);
        if (msg) msg.innerHTML = '<span style="color:#16a34a">PIN berhasil disimpan</span>';
        const lab = document.getElementById('pin-status-label');
        if (lab) lab.textContent = 'Sudah diatur';
        const ow = document.getElementById('pin-old-wrap');
        if (ow) ow.style.display = 'block';
        ['prof-pin-old','prof-pin-new','prof-pin-new2'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        showToast('PIN disimpan', 'success');
      } else {
        if (msg) msg.innerHTML = '<span style="color:#e11d48">' + (j.message || 'Gagal') + '</span>';
        showToast(j.message || 'Gagal simpan PIN', 'error');
      }
    } catch (err) {
      if (msg) msg.innerHTML = '<span style="color:#e11d48">Gagal terhubung</span>';
    }
  }
});

// bootIdleOnLoad — sesi countdown jika sudah login
(function bootIdleOnLoad() {
  try {
    const u = typeof getUser === 'function' ? getUser() : null;
    if (u && window.BdSecurity) {
      BdSecurity.startIdleWatch({
        onLogout: () => {
          try {
            if (typeof setUser === 'function') setUser(null);
            localStorage.removeItem('ppob_user');
            localStorage.removeItem('bdpay_user');
            localStorage.removeItem('user');
            Object.keys(localStorage).forEach(function (k) {
              if (/user|token|bdpay/i.test(k)) localStorage.removeItem(k);
            });
          } catch (_) {}
          if (typeof showToast === 'function') showToast('Sesi berakhir. Silakan login kembali.', 'warn');
          setTimeout(function () {
            if (typeof openLoginModal === 'function') openLoginModal();
            else location.reload();
          }, 300);
        }
      });
    }
  } catch (_) {}
})();
