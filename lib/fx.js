// Exchange rates for showing an amount in cedis in someone's own currency.
// Source: ExchangeRate-API open access (https://www.exchangerate-api.com):
// free, commercial use and caching allowed, attribution required (shown in
// the app wherever converted amounts appear). Fetched at most every 12 hours;
// the last good rates are kept in the database for restarts or bad moments.
const FxRate = require('../models/FxRate');

const MAX_AGE = 12 * 3600 * 1000;
let memo = null; // { rates, fetchedAt, sourceUpdatedAt }

async function ratesFromGHS() {
  if (memo && Date.now() - memo.fetchedAt < MAX_AGE) return memo;
  if (!memo) {
    try { const d = await FxRate.findById('GHS'); if (d) memo = { rates: d.rates, fetchedAt: d.fetchedAt, sourceUpdatedAt: d.sourceUpdatedAt }; } catch (e) { /* no saved rates yet */ }
    if (memo && Date.now() - memo.fetchedAt < MAX_AGE) return memo;
  }
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/GHS');
    const j = await r.json();
    if (j && j.result === 'success' && j.rates && typeof j.rates === 'object') {
      memo = { rates: j.rates, fetchedAt: Date.now(), sourceUpdatedAt: (j.time_last_update_unix || 0) * 1000 };
      try { await FxRate.findOneAndUpdate({ _id: 'GHS' }, { $set: memo }, { upsert: true }); } catch (e) { /* keep going */ }
    }
  } catch (e) { /* unreachable right now: keep the last known rates */ }
  return memo;
}

// An amount in cedis (minor units) shown in another currency, or null if no rate is known.
async function fromGHS(amountMinorGHS, currency) {
  if (!currency || currency === 'GHS') return { amountMinor: amountMinorGHS, currency: 'GHS', rate: 1, asOf: null };
  const m = await ratesFromGHS();
  const rate = m && m.rates && Number(m.rates[currency]);
  if (!rate || !Number.isFinite(rate)) return null;
  return { amountMinor: Math.round(amountMinorGHS * rate), currency, rate, asOf: m.sourceUpdatedAt || m.fetchedAt };
}

// Any currency to any other (via the cedi-based rates), or null if unknown.
async function convert(amount, from, to) {
  if (from === to) return { amount, currency: to, approx: false };
  const m = await ratesFromGHS();
  const rf = from === 'GHS' ? 1 : m && m.rates && Number(m.rates[from]);
  const rt = to === 'GHS' ? 1 : m && m.rates && Number(m.rates[to]);
  if (!rf || !rt) return null;
  return { amount: Math.round((amount / rf) * rt * 100) / 100, currency: to, approx: true };
}

function _resetForTests() { memo = null; }
module.exports = { fromGHS, convert, ratesFromGHS, _resetForTests };
