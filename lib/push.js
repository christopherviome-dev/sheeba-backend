// Phone alerts (Web Push): a real notification with the phone's own sound,
// even when Mepluge is closed. The security keys (VAPID) come from Render if
// set (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY), otherwise they are created once
// and kept privately in the database, so there is nothing to set up.
const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');
const { getSetting, setSetting } = require('./settings');
const { rings } = require('./alertPrefs');
let ready = null;

async function keys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  let k = await getSetting('vapidKeys');
  if (!k || !k.publicKey || !k.privateKey) { k = webpush.generateVAPIDKeys(); await setSetting('vapidKeys', k, null); }
  return k;
}
function setup() {
  if (!ready) {
    ready = keys().then((k) => { webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:hello@mepluge.com', k.publicKey, k.privateKey); return k; })
      .catch((e) => { ready = null; throw e; });
  }
  return ready;
}
const publicKey = async () => (await setup()).publicKey;

// A phone subscription from the browser, checked before it is stored.
function cleanSubscription(sub) {
  if (!sub || typeof sub !== 'object' || typeof sub.endpoint !== 'string') return null;
  if (!/^https:\/\/[^\s]{8,}$/.test(sub.endpoint) || sub.endpoint.length > 1000) return null;
  const k = sub.keys || {};
  const ok = (v, min, max) => typeof v === 'string' && /^[A-Za-z0-9_=-]+$/.test(v) && v.length >= min && v.length <= max;
  if (!ok(k.p256dh, 40, 200) || !ok(k.auth, 12, 60)) return null;
  return { endpoint: sub.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } };
}

// Send one alert to every phone of a person. Phones that have switched alerts
// off or uninstalled (404/410) are forgotten. Never throws.
async function sendPush(ownerType, ownerId, payload) {
  try { await setup(); } catch (e) { return 0; }
  if (payload && payload.tag && payload.tag !== 'test') {
    try {
      const saved = await require('../models/AlertPref').findOne({ ownerType, ownerId: String(ownerId) });
      if (!rings(saved && saved.prefs, payload.tag)) return 0; // they chose not to be rung for this group
    } catch (e) { /* if in doubt, ring */ }
  }
  let subs = [];
  try { subs = await PushSubscription.find({ ownerType, ownerId: String(ownerId) }); } catch (e) { return 0; }
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }, JSON.stringify(payload), { TTL: 24 * 3600, urgency: 'high' });
      sent += 1;
      try { await PushSubscription.updateOne({ endpoint: s.endpoint }, { lastSentAt: Date.now() }); } catch (e) { /* not important */ }
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) { try { await PushSubscription.deleteOne({ endpoint: s.endpoint }); } catch (x) { /* ignore */ } }
    }
  }));
  return sent;
}

module.exports = { publicKey, sendPush, cleanSubscription, _resetForTests: () => { ready = null; } };
