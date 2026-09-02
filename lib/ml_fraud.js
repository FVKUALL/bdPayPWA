/**
 * Rule-based ML-style fraud / risk scoring (editable thresholds via settings)
 */

const DEFAULT_ML = {
  enabled: true,
  fraud: {
    low_amount_threshold: 50000,
    low_amount_count: 10,
    low_amount_window_min: 15,
    burst_count: 10,
    burst_window_min: 15,
    same_account_count: 10,
    same_account_window_min: 60,
    weights: {
      low_amount_burst: 2,
      tx_burst: 2,
      same_account: 2,
      new_device: 1,
      new_location: 1
    }
  },
  thief: {
    enabled: true,
    new_device_score: 1,
    new_location_score: 1
  },
  actions: {
    warn_from_risk: 3,
    hold_from_risk: 4
  },
  learning: {
    // simple adaptive: multiply weights if pattern repeats often
    adaptive: true,
    boost_factor: 1.1,
    max_weight: 5
  }
};

function getMlConfig(settings) {
  const ml = (settings && settings.ml) || {};
  return {
    ...DEFAULT_ML,
    ...ml,
    fraud: { ...DEFAULT_ML.fraud, ...(ml.fraud || {}), weights: { ...DEFAULT_ML.fraud.weights, ...((ml.fraud && ml.fraud.weights) || {}) } },
    thief: { ...DEFAULT_ML.thief, ...(ml.thief || {}) },
    actions: { ...DEFAULT_ML.actions, ...(ml.actions || {}) },
    learning: { ...DEFAULT_ML.learning, ...(ml.learning || {}) }
  };
}

function withinMin(iso, minutes) {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() <= minutes * 60 * 1000;
}

/**
 * Score actor risk from recent transactions + device/location flags
 * @returns { risk: 1-5, factors: string[], score: number }
 */
function evaluateRisk({ txs, actorId, currentTx, deviceId, knownDevices, locationKey, knownLocations, cfg }) {
  const c = cfg || DEFAULT_ML;
  if (c.enabled === false) return { risk: 1, factors: [], score: 0 };

  const weights = c.fraud.weights || {};
  let score = 0;
  const factors = [];
  const list = Array.isArray(txs) ? txs : [];

  // Filter actor txs
  const mine = list.filter(t =>
    t.user_id === actorId || t.merchant_id === actorId || t.actor_id === actorId
  );

  const lowWin = c.fraud.low_amount_window_min || 15;
  const lowThr = c.fraud.low_amount_threshold || 50000;
  const lowNeed = c.fraud.low_amount_count || 10;
  const lowRecent = mine.filter(t => withinMin(t.created_at, lowWin) && Number(t.amount || t.grand_total || 0) < lowThr);
  if (lowRecent.length >= lowNeed) {
    score += Number(weights.low_amount_burst) || 2;
    factors.push(`Burst nominal kecil (<${lowThr}) ${lowRecent.length}x / ${lowWin} mnt`);
  }

  const burstWin = c.fraud.burst_window_min || 15;
  const burstNeed = c.fraud.burst_count || 10;
  const burst = mine.filter(t => withinMin(t.created_at, burstWin));
  if (burst.length >= burstNeed) {
    score += Number(weights.tx_burst) || 2;
    factors.push(`Frekuensi tinggi ${burst.length}x / ${burstWin} mnt`);
  }

  const sameWin = c.fraud.same_account_window_min || 60;
  const sameNeed = c.fraud.same_account_count || 10;
  const dest = currentTx && (currentTx.account || currentTx.destination_account || currentTx.customer_no);
  if (dest) {
    const same = mine.filter(t =>
      withinMin(t.created_at, sameWin) &&
      String(t.account || t.destination_account || t.customer_no || '') === String(dest)
    );
    if (same.length >= sameNeed) {
      score += Number(weights.same_account) || 2;
      factors.push(`Rekening sama ${same.length}x / ${sameWin} mnt`);
    }
  }

  if (c.thief && c.thief.enabled !== false) {
    if (deviceId && Array.isArray(knownDevices) && knownDevices.length && !knownDevices.includes(deviceId)) {
      score += Number(c.thief.new_device_score) || Number(weights.new_device) || 1;
      factors.push('Perangkat baru');
    }
    if (locationKey && Array.isArray(knownLocations) && knownLocations.length && !knownLocations.includes(locationKey)) {
      score += Number(c.thief.new_location_score) || Number(weights.new_location) || 1;
      factors.push('Lokasi baru');
    }
  }

  // Map score to risk 1-5
  let risk = 1;
  if (score >= 5) risk = 5;
  else if (score >= 4) risk = 4;
  else if (score >= 3) risk = 3;
  else if (score >= 2) risk = 2;
  else risk = 1;

  // Learning boost (proportional)
  if (c.learning && c.learning.adaptive && factors.length >= 2) {
    risk = Math.min(5, risk + 1);
    factors.push('Learning: multi-faktor');
  }

  return { risk, factors, score };
}

module.exports = { DEFAULT_ML, getMlConfig, evaluateRisk };
