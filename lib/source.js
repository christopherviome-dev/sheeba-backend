// Where a sign-up or booking came from: first touch, remembered on the
// person's phone for 30 days, cleaned and checked here. Marketing-link codes
// are looked up so the channel (WhatsApp, Instagram, …) comes from the
// professional's own link, never from what the browser claims.
const TYPES = ['link', 'invite', 'shop', 'look', 'direct', 'rebook'];
const clip = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

function cleanSource(raw) {
  if (!raw || typeof raw !== 'object' || !TYPES.includes(raw.type)) return null;
  return {
    type: raw.type, code: clip(raw.code, 40), shopId: clip(raw.shopId, 40), channel: null,
    referrerHost: clip(raw.referrerHost, 80), at: typeof raw.at === 'number' && raw.at > 0 && raw.at <= Date.now() + 60000 ? raw.at : null,
  };
}

async function resolveSource(raw) {
  const s = cleanSource(raw);
  if (!s) return null;
  if (s.type === 'link') {
    const Referral = require('../models/Referral');
    let r = null;
    try { r = s.code ? await Referral.findOne({ code: s.code, active: true }) : null; } catch (e) { /* ignore */ }
    if (r) { s.channel = r.channel; s.shopId = r.stylistId; } else { s.type = s.shopId ? 'shop' : 'direct'; s.code = null; }
  }
  return s;
}

module.exports = { TYPES, cleanSource, resolveSource };
