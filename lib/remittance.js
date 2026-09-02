/**
 * Global Remittance sandbox: Ria Money Transfer, MoneyGram, Western Union
 */
function simulateQuote(provider, { amount, source_currency, dest_currency, dest_country }) {
  const amt = Number(amount) || 0;
  const rateBase = { USD: 1, IDR: 0.000062, PHP: 0.017, MYR: 0.21, SGD: 0.74 }[String(source_currency || 'IDR').toUpperCase()] || 0.000062;
  const dest = String(dest_currency || 'USD').toUpperCase();
  const destRate = { USD: 1, PHP: 56, MYR: 4.7, SGD: 1.35, IDR: 16200 }[dest] || 1;
  const fx = rateBase * destRate * (0.985 + Math.random() * 0.02);
  const fee = provider === 'westernunion' ? 12 : provider === 'moneygram' ? 10 : 9;
  const receive = Math.round(amt * fx * 100) / 100;
  return {
    provider,
    mode: 'sandbox',
    source_amount: amt,
    source_currency: String(source_currency || 'IDR').toUpperCase(),
    dest_currency: dest,
    dest_country: dest_country || 'US',
    fx_rate: Math.round(fx * 1e6) / 1e6,
    fee_usd: fee,
    receive_amount: receive,
    eta: provider === 'ria' ? '15-60 menit' : 'Minutes to hours',
    reference: 'RMX-' + provider.slice(0, 3).toUpperCase() + '-' + Date.now().toString().slice(-8)
  };
}

function simulateSend(provider, payload) {
  const q = simulateQuote(provider, payload);
  return {
    success: true,
    simulated: true,
    mode: 'sandbox',
    status: 'pending',
    tracking_number: 'TRK' + Date.now().toString().slice(-10),
    ...q,
    message: 'Remittance ' + provider + ' sandbox — menunggu pickup/disbursement simulasi'
  };
}

async function executeRemittance(providerName, conf, params) {
  const mode = String(conf?.mode || 'sandbox').toLowerCase();
  const name = String(providerName || '').toLowerCase().replace(/\s+/g, '');
  const map = {
    ria: 'ria',
    riamoneytransfer: 'ria',
    moneygram: 'moneygram',
    westernunion: 'westernunion',
    wu: 'westernunion'
  };
  const p = map[name] || name;
  if (mode === 'sandbox' || !conf?.api_key) {
    await new Promise(r => setTimeout(r, 50));
    if (params.action === 'quote') return { success: true, ...simulateQuote(p, params) };
    return simulateSend(p, params);
  }
  // production stub
  return { success: false, message: 'Production remittance belum dikonfigurasi untuk ' + p, provider: p };
}

module.exports = { executeRemittance, simulateQuote, simulateSend };
