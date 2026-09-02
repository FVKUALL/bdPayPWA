/**
 * PPOB & Payment Provider Integrations
 * Digiflazz, IAK, Raja-Biller | bdPay, Midtrans, DOKU, Xendit
 * Menggunakan native fetch (Node 18+). Fallback mock jika kredensial kosong.
 */
const crypto = require('crypto');

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function sha512(str) {
  return crypto.createHash('sha512').update(str).digest('hex');
}

async function httpJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 30000);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

function hasCreds(obj, keys) {
  return keys.every(k => obj && obj[k] && String(obj[k]).trim() !== '');
}

// ===================== PPOB: DIGIFLAZZ =====================
async function digiflazzTopup({ username, apiKey, baseUrl, mode }, { sku, customerNo, refId }) {
  const url = (baseUrl || 'https://api.digiflazz.com/v1').replace(/\/$/, '') + '/transaction';
  const sign = md5(username + apiKey + refId);
  const body = {
    username,
    buyer_sku_code: sku,
    customer_no: customerNo,
    ref_id: refId,
    sign
  };
  if (mode === 'sandbox' || mode === 'development' || mode === 'dev') body.testing = true;

  const { ok, data } = await httpJson(url, { method: 'POST', body: JSON.stringify(body) });
  const d = data?.data || data || {};
  const statusRaw = (d.status || '').toString().toLowerCase();
  const success = statusRaw === 'sukses' || statusRaw === 'success';
  const pending = statusRaw === 'pending' || statusRaw === '0';
  return {
    success: success || pending,
    pending,
    message: d.message || (success ? 'Sukses via Digiflazz' : pending ? 'Pending Digiflazz' : (d.message || 'Gagal Digiflazz')),
    sn: d.sn || null,
    rc: d.rc,
    price: d.price,
    raw: d,
    provider: 'digiflazz'
  };
}

// ===================== PPOB: IAK =====================
async function iakTopup({ username, apiKey, baseUrlPrepaid, mode }, { sku, customerNo, refId }) {
  const base = (baseUrlPrepaid || (mode === 'production' ? 'https://prepaid.iak.id' : 'https://prepaid.iak.dev')).replace(/\/$/, '');
  const url = base + '/api/top-up';
  const sign = md5(username + apiKey + refId);
  const body = {
    username,
    ref_id: refId,
    customer_id: customerNo,
    product_code: sku,
    sign
  };

  const { ok, data } = await httpJson(url, { method: 'POST', body: JSON.stringify(body) });
  const d = data?.data || data || {};
  // IAK: status 1 = success, 0/2 = process/failed depending on docs
  const code = d.status ?? d.response_code ?? data?.status;
  const success = code == 1 || code === '1' || String(d.message || '').toLowerCase().includes('success');
  const pending = code == 0 || code === '0' || code == 2;
  return {
    success: success || pending,
    pending: !success && pending,
    message: d.message || data?.message || (success ? 'Sukses via IAK' : 'Response IAK'),
    sn: d.sn || d.serial_number || null,
    rc: code,
    raw: d,
    provider: 'iak'
  };
}

// ===================== PPOB: RAJA-BILLER =====================
// Generic REST shape umum dipakai aggregator Indonesia (sesuaikan base_url & path di settings)
async function rajaBillerTopup({ username, apiKey, baseUrl, mode }, { sku, customerNo, refId }) {
  if (!apiKey && !username) {
    // sandbox simulasi tanpa kredensial
    return {
      success: true,
      pending: true,
      message: 'Raja-Biller sandbox (simulasi kredensial kosong)',
      sn: null,
      provider: 'raja-biller',
      simulated: true,
      raw: { ref_id: refId, sku, customer_no: customerNo }
    };
  }
  if (!baseUrl) {
    baseUrl = (mode === 'production') ? 'https://api.raja-biller.com' : 'https://api-sandbox.raja-biller.com';
  }
  const url = baseUrl.replace(/\/$/, '') + '/transaction';
  const sign = md5(username + apiKey + refId);
  const body = {
    username,
    product_code: sku,
    customer_no: customerNo,
    ref_id: refId,
    sign,
    testing: (mode === 'sandbox' || mode === 'development' || !mode)
  };
  const { ok, data } = await httpJson(url, { method: 'POST', body: JSON.stringify(body) });
  const d = data?.data || data || {};
  const statusRaw = String(d.status || d.rc || '').toLowerCase();
  const success = ['sukses', 'success', '1', '00'].includes(statusRaw);
  return {
    success,
    message: d.message || (success ? 'Sukses via Raja-Biller' : 'Gagal Raja-Biller'),
    sn: d.sn || null,
    raw: d,
    provider: 'raja-biller'
  };
}

// ===================== PAYMENT: bdPay =====================
// ===================== PAYMENT: BDPAY (sandbox QRIS + VA) =====================
async function bdpayCreatePayment(conf, params) {
  const {
    merchantCode, apiKey, baseUrl, mode, webhookUrl, webhookSecret
  } = conf;
  const { orderId, amount, method, name, email, phone, notifyUrl, bank } = params;
  const isSandbox = (mode || 'sandbox') !== 'production';
  const base = (baseUrl || (isSandbox ? 'https://dev-openapi.bdpay.co.id' : 'https://openapi.bdpay.co.id')).replace(/\/$/, '');
  const methodNorm = String(method || 'va').toLowerCase();
  const isQris = methodNorm === 'qris' || methodNorm === 'ewallet';
  const notify = notifyUrl || webhookUrl || '';

  // Sandbox / no full credentials → deterministic local sandbox payload
  if (isSandbox || !hasCreds({ merchantCode, apiKey }, ['merchantCode'])) {
    const va = '88' + String(Math.abs(hashCode(orderId + String(amount))) % 1e10).padStart(10, '0');
    return {
      success: true,
      message: 'bdPay sandbox ' + (isQris ? 'QRIS' : 'VA') + ' created',
      payment_url: null,
      va_number: isQris ? null : va,
      va_bank: isQris ? null : (bank || 'bca'),
      qr_string: isQris ? buildDemoQris(orderId, amount, 'bdPay') : null,
      qr_url: isQris ? null : null,
      transaction_id: 'BDPAY-SB-' + orderId,
      expires_in_minutes: 30,
      webhook_url: notify,
      provider: 'bdpay',
      simulated: true,
      method: isQris ? 'qris' : 'va'
    };
  }

  const url = base + '/api/v1/payment/create';
  const body = {
    merchantCode,
    method: isQris ? 'QRIS' : ('VA_' + String(bank || 'BCA').toUpperCase()),
    orderNum: orderId,
    payMoney: String(Math.round(amount)),
    productDetail: 'bdPay PWA',
    name: name || 'Customer',
    email: email || 'customer@bdpay.local',
    phone: phone || '081234567890',
    notifyUrl: notify,
    expiryPeriod: '30',
    dateTime: new Date().toISOString(),
    sign: apiKey || ''
  };
  const { ok, data } = await httpJson(url, { method: 'POST', body: JSON.stringify(body) });
  const success = data?.platRespCode === 'SUCCESS' || ok;
  return {
    success,
    message: data?.platRespMessage || (success ? 'bdPay payment created' : 'bdPay error'),
    payment_url: data?.url || null,
    va_number: data?.vaNumber || data?.payCode || null,
    qr_string: data?.qrContent || data?.qrString || null,
    transaction_id: data?.platOrderNum || null,
    webhook_url: notify,
    provider: 'bdpay',
    simulated: false,
    method: isQris ? 'qris' : 'va',
    raw: data
  };
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) h = ((h << 5) - h) + String(str).charCodeAt(i) | 0;
  return h;
}

function buildDemoQris(orderId, amount, merchant) {
  // Dummy EMVCo-like QRIS string for UI display (not a real payable QR)
  const amt = Math.round(Number(amount) || 0);
  return '00020101021226650016ID.CO.QRIS.WWW0118' + String(merchant || 'BDPAY').slice(0, 18).toUpperCase() +
    '52045812530336054' + String(String(amt).length).padStart(2, '0') + amt +
    '5802ID5913' + String(merchant || 'bdPay').slice(0, 13) + '6007JAKARTA62' +
    String(25 + String(orderId).length).padStart(2, '0') + '05' + String(String(orderId).length).padStart(2, '0') + orderId + '6304ABCD';
}

// ===================== PAYMENT: MIDTRANS (sandbox charge QRIS + VA) =====================
async function midtransCharge(conf, params) {
  const { serverKey, baseUrl, mode, webhookUrl } = conf;
  const { orderId, amount, method, customer, bank } = params;
  const isSandbox = (mode || 'sandbox') !== 'production';
  const base = (baseUrl || (isSandbox ? 'https://api.sandbox.midtrans.com' : 'https://api.midtrans.com')).replace(/\/$/, '');
  const methodNorm = String(method || 'va').toLowerCase();
  const isQris = methodNorm === 'qris' || methodNorm === 'ewallet';

  if (!serverKey || !String(serverKey).trim()) {
    const va = '88' + String(Math.abs(hashCode('mt' + orderId)) % 1e10).padStart(10, '0');
    return {
      success: true,
      message: 'Midtrans sandbox (simulasi kredensial kosong)',
      va_number: isQris ? null : va,
      va_bank: isQris ? null : (bank || 'bca'),
      qr_string: isQris ? buildDemoQris(orderId, amount, 'MIDTRANS') : null,
      transaction_id: 'MT-SB-' + orderId,
      webhook_url: webhookUrl || null,
      provider: 'midtrans',
      simulated: true,
      method: isQris ? 'qris' : 'va'
    };
  }

  const auth = Buffer.from(serverKey + ':').toString('base64');
  const body = {
    transaction_details: { order_id: orderId, gross_amount: Math.round(amount) },
    customer_details: {
      first_name: customer?.name || 'Customer',
      email: customer?.email || 'customer@bdpay.local',
      phone: customer?.phone || '081234567890'
    }
  };
  if (isQris) {
    body.payment_type = 'qris';
    body.qris = { acquirer: 'gopay' };
  } else {
    const b = String(bank || methodNorm.replace('va_', '') || 'bca').toLowerCase();
    body.payment_type = 'bank_transfer';
    body.bank_transfer = { bank: b };
  }

  const { ok, data } = await httpJson(base + '/v2/charge', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + auth },
    body: JSON.stringify(body)
  });
  const success = ['201', '200'].includes(String(data?.status_code)) || ok;
  const va = data?.va_numbers?.[0];
  const qrAction = (data?.actions || []).find(a => a.name === 'generate-qr-code' || a.name === 'qr-code');
  return {
    success,
    message: data?.status_message || (success ? 'Midtrans charge OK' : 'Midtrans error'),
    payment_url: qrAction?.url || null,
    va_number: va?.va_number || data?.permata_va_number || null,
    va_bank: va?.bank || null,
    qr_string: data?.qr_string || null,
    transaction_id: data?.transaction_id,
    webhook_url: webhookUrl || null,
    provider: 'midtrans',
    simulated: false,
    method: isQris ? 'qris' : 'va',
    raw: data
  };
}

// ===================== PAYMENT: DOKU (sandbox VA + QRIS) =====================
async function dokuCreatePayment(conf, params) {
  const { clientId, sharedKey, baseUrl, mode, webhookUrl } = conf;
  const { orderId, amount, method, customer, callbackUrl, returnUrl, bank } = params;
  const isSandbox = (mode || 'sandbox') !== 'production';
  const methodNorm = String(method || 'va').toLowerCase();
  const isQris = methodNorm === 'qris' || methodNorm === 'ewallet';

  if (!clientId || !sharedKey) {
    const va = '88' + String(Math.abs(hashCode('dk' + orderId)) % 1e10).padStart(10, '0');
    return {
      success: true,
      message: 'DOKU sandbox (simulasi)',
      va_number: isQris ? null : va,
      va_bank: isQris ? null : (bank || 'bca'),
      qr_string: isQris ? buildDemoQris(orderId, amount, 'DOKU') : null,
      transaction_id: 'DK-SB-' + orderId,
      webhook_url: webhookUrl || callbackUrl || null,
      provider: 'doku',
      simulated: true,
      method: isQris ? 'qris' : 'va'
    };
  }

  const base = (baseUrl || (isSandbox ? 'https://api-sandbox.doku.com' : 'https://api.doku.com')).replace(/\/$/, '');
  const requestId = orderId;
  const requestTimestamp = new Date().toISOString();
  const digest = crypto.createHmac('sha256', sharedKey)
    .update(String(clientId) + requestId + requestTimestamp + String(Math.round(amount)))
    .digest('base64');
  const body = {
    order: {
      invoice_number: orderId,
      amount: Math.round(amount),
      currency: 'IDR',
      callback_url: callbackUrl || webhookUrl || '',
      callback_url_cancel: returnUrl || ''
    },
    payment: { payment_due_date: 60 },
    customer: {
      name: customer?.name || 'Customer',
      email: customer?.email || 'customer@bdpay.local',
      phone: customer?.phone || '081234567890'
    }
  };
  const { ok, data } = await httpJson(base + '/checkout/v1/payment', {
    method: 'POST',
    headers: {
      'Client-Id': clientId,
      'Request-Id': requestId,
      'Request-Timestamp': requestTimestamp,
      Signature: 'HMACSHA256=' + digest
    },
    body: JSON.stringify(body)
  });
  return {
    success: ok && !data?.error,
    message: data?.message || (ok ? 'DOKU payment created' : 'DOKU error'),
    payment_url: data?.response?.payment?.url || data?.payment?.url || data?.url || null,
    va_number: data?.virtual_account_info?.virtual_account_number || data?.va_number || null,
    qr_string: data?.qr_content || null,
    transaction_id: data?.transaction?.id || orderId,
    webhook_url: webhookUrl || callbackUrl || null,
    provider: 'doku',
    simulated: false,
    method: isQris ? 'qris' : 'va',
    raw: data
  };
}

// ===================== PAYMENT: XENDIT =====================
async function xenditCreateInvoice(conf, params) {
  const { secretKey, baseUrl, mode, webhookUrl } = conf;
  const { orderId, amount, method, customer } = params;
  const isQris = String(method || '').toLowerCase().includes('qris');
  if (!secretKey) {
    const va = '88' + String(Math.abs(hashCode('xd' + orderId)) % 1e10).padStart(10, '0');
    return {
      success: true,
      message: 'Xendit sandbox (simulasi)',
      va_number: isQris ? null : va,
      qr_string: isQris ? buildDemoQris(orderId, amount, 'XENDIT') : null,
      transaction_id: 'XD-SB-' + orderId,
      webhook_url: webhookUrl || null,
      provider: 'xendit',
      simulated: true,
      method: isQris ? 'qris' : 'va'
    };
  }
  const base = (baseUrl || 'https://api.xendit.co').replace(/\/$/, '');
  const auth = Buffer.from(secretKey + ':').toString('base64');
  const body = {
    external_id: orderId,
    amount: Math.round(amount),
    description: 'bdPay PWA',
    invoice_duration: 1800,
    customer: {
      given_names: customer?.name || 'Customer',
      email: customer?.email || 'customer@bdpay.local'
    },
    success_redirect_url: params.returnUrl || '',
    failure_redirect_url: params.returnUrl || ''
  };
  const { ok, data } = await httpJson(base + '/v2/invoices', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + auth },
    body: JSON.stringify(body)
  });
  return {
    success: ok,
    message: data?.message || (ok ? 'Xendit invoice created' : 'Xendit error'),
    payment_url: data?.invoice_url || null,
    va_number: null,
    qr_string: null,
    transaction_id: data?.id,
    webhook_url: webhookUrl || null,
    provider: 'xendit',
    simulated: false,
    raw: data
  };
}

async function executePayment(providerName, conf, params) {
  const confNorm = {
    merchantCode: conf.merchant_code,
    apiKey: conf.api_key,
    serverKey: conf.server_key,
    clientKey: conf.client_key,
    clientId: conf.client_id,
    sharedKey: conf.shared_key,
    secretKey: conf.secret_key,
    baseUrl: conf.base_url,
    mode: conf.mode || 'sandbox',
    webhookUrl: conf.webhook_url || conf.callback_url || '',
    webhookSecret: conf.webhook_secret || conf.callback_token || ''
  };

  try {
    if (providerName === 'bdpay') return await bdpayCreatePayment(confNorm, params);
    if (providerName === 'midtrans') return await midtransCharge(confNorm, params);
    if (providerName === 'doku') return await dokuCreatePayment(confNorm, params);
    if (providerName === 'xendit') return await xenditCreateInvoice(confNorm, params);
    return { success: false, message: 'Payment provider tidak dikenal', provider: providerName };
  } catch (err) {
    return { success: false, message: err.message || String(err), provider: providerName };
  }
}


/**
 * Auto-switch PPOB provider. conf = settings.api_ppob[name]
 */
async function executePPOB(providerName, conf, params) {
  const confNorm = {
    username: conf.username,
    apiKey: conf.api_key,
    baseUrl: conf.base_url,
    baseUrlPrepaid: conf.base_url_prepaid,
    baseUrlPostpaid: conf.base_url_postpaid,
    mode: conf.mode || 'sandbox'
  };

  const hasReal = {
    digiflazz: hasCreds(confNorm, ['username', 'apiKey']),
    iak: hasCreds(confNorm, ['username', 'apiKey']),
    'raja-biller': hasCreds(confNorm, ['username', 'apiKey']) || !!(conf.base_url || confNorm.baseUrl)
  };

  const mode = String(confNorm.mode || conf.mode || 'sandbox').toLowerCase();
  const forceSandbox = mode === 'sandbox' || mode === 'development' || mode === 'dev' || conf.force_sandbox === true;

  // Sandbox tanpa kredensial ATAU force_sandbox tanpa testing API → simulasi penuh
  if (!hasReal[providerName] || (forceSandbox && conf.sandbox_simulate_only !== false && !hasReal[providerName])) {
    await new Promise(r => setTimeout(r, 40 + Math.floor(Math.random() * 80)));
    const sn = 'SBX-' + providerName.replace(/[^a-z]/gi, '').toUpperCase().slice(0, 4) + '-' + Date.now().toString().slice(-8);
    return {
      success: true,
      pending: false,
      message: 'Sukses sandbox ' + providerName + ' (simulasi)',
      sn,
      rc: '00',
      price: params.price || null,
      provider: providerName,
      simulated: true,
      mode: 'sandbox'
    };
  }

  // Mode sandbox + ada kredensial → panggil API testing/dev endpoint
  try {
    confNorm.mode = forceSandbox ? 'sandbox' : (confNorm.mode || 'production');
    let result;
    if (providerName === 'digiflazz') result = await digiflazzTopup(confNorm, params);
    else if (providerName === 'iak') result = await iakTopup(confNorm, params);
    else if (providerName === 'raja-biller') result = await rajaBillerTopup(confNorm, params);
    else return { success: false, message: 'Provider tidak dikenal: ' + providerName, provider: providerName };

    // Jika API sandbox gagal koneksi, fallback simulasi agar UX tetap jalan
    if (forceSandbox && result && result.success === false && /fetch|network|abort|ENOTFOUND|timeout/i.test(String(result.message || ''))) {
      return {
        success: true,
        pending: false,
        message: 'Sandbox ' + providerName + ' fallback simulasi (' + (result.message || 'api error') + ')',
        sn: 'SBX-FB-' + Date.now().toString().slice(-8),
        rc: '00',
        provider: providerName,
        simulated: true,
        mode: 'sandbox',
        api_error: result.message
      };
    }
    return { ...result, mode: confNorm.mode };
  } catch (err) {
    if (forceSandbox) {
      return {
        success: true,
        pending: false,
        message: 'Sandbox ' + providerName + ' fallback: ' + (err.message || String(err)),
        sn: 'SBX-EX-' + Date.now().toString().slice(-8),
        provider: providerName,
        simulated: true,
        mode: 'sandbox'
      };
    }
    return { success: false, message: err.message || String(err), provider: providerName };
  }
}

module.exports = {
  executePPOB,
  executePayment,
  digiflazzTopup,
  iakTopup,
  rajaBillerTopup,
  bdpayCreatePayment,
  midtransCharge,
  dokuCreatePayment,
  xenditCreateInvoice,
  md5,
  sha512
};
