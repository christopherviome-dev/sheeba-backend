const express = require('express');
const PushSubscription = require('../models/PushSubscription');
const { publicKey, sendPush, cleanSubscription } = require('../lib/push');
const { identifyActor } = require('./messages');
const router = express.Router();
const MAX_PHONES = 10; // per person

// The public key browsers need to ask for alerts.
router.get('/public-key', async (req, res) => {
  try { res.json({ key: await publicKey() }); } catch (e) { res.status(503).json({ error: 'Phone alerts are not available right now.' }); }
});

// This phone wants alerts for whoever is logged in on it.
router.post('/subscribe', async (req, res) => {
  const actor = identifyActor(req);
  if (!actor) return res.status(401).json({ error: 'Log in first.' });
  const sub = cleanSubscription(req.body && req.body.subscription);
  if (!sub) return res.status(400).json({ error: "This phone's alert address isn't valid. Try again." });
  await PushSubscription.findOneAndUpdate({ endpoint: sub.endpoint }, { ownerType: actor.type, ownerId: actor.id, keys: sub.keys, createdAt: Date.now() }, { upsert: true, new: true });
  const mine = await PushSubscription.find({ ownerType: actor.type, ownerId: actor.id });
  if (mine.length > MAX_PHONES) {
    const old = mine.sort((a, b) => a.createdAt - b.createdAt).slice(0, mine.length - MAX_PHONES);
    await Promise.all(old.map((o) => PushSubscription.deleteOne({ endpoint: o.endpoint })));
  }
  res.json({ ok: true });
});

// Stop alerts on this phone.
router.post('/unsubscribe', async (req, res) => {
  const actor = identifyActor(req);
  if (!actor) return res.status(401).json({ error: 'Log in first.' });
  const endpoint = req.body && typeof req.body.endpoint === 'string' ? req.body.endpoint : null;
  if (!endpoint) return res.status(400).json({ error: 'Nothing to stop.' });
  await PushSubscription.deleteOne({ endpoint, ownerType: actor.type, ownerId: actor.id });
  res.json({ ok: true });
});

// "Send me a test" so people hear exactly what an alert sounds like.
router.post('/test', async (req, res) => {
  const actor = identifyActor(req);
  if (!actor) return res.status(401).json({ error: 'Log in first.' });
  const sent = await sendPush(actor.type, actor.id, { title: 'Mepluge alerts are on ✓', body: "This is how you'll hear about new bookings and messages.", url: '/notifications', tag: 'test' });
  res.json({ sent });
});

// Which groups ring this person's phone (admin work only for admins).
const { prefsOf, cleanPrefs } = require('../lib/alertPrefs');
const { roleById } = require('../lib/adminRoles');
const AlertPref = require('../models/AlertPref');
async function groupsFor(actor) {
  const base = actor.type === 'customer' ? ['bookings', 'messages', 'looks', 'rewards', 'account'] : ['bookings', 'messages', 'looks', 'team', 'rewards', 'account'];
  if (actor.type !== 'customer') { let role = null; try { role = await roleById(actor.id); } catch (e) { /* none */ } if (role) base.push('admin'); }
  return base;
}
router.get('/prefs', async (req, res) => {
  const actor = identifyActor(req);
  if (!actor) return res.status(401).json({ error: 'Log in first.' });
  const groups = await groupsFor(actor);
  const saved = await AlertPref.findOne({ ownerType: actor.type, ownerId: actor.id });
  const all = prefsOf(saved && saved.prefs);
  res.json({ groups, prefs: Object.fromEntries(groups.map((g) => [g, all[g]])) });
});
router.put('/prefs', async (req, res) => {
  const actor = identifyActor(req);
  if (!actor) return res.status(401).json({ error: 'Log in first.' });
  const saved = await AlertPref.findOne({ ownerType: actor.type, ownerId: actor.id });
  const prefs = { ...prefsOf(saved && saved.prefs), ...cleanPrefs(req.body && req.body.prefs) };
  await AlertPref.findOneAndUpdate({ ownerType: actor.type, ownerId: actor.id }, { prefs, updatedAt: Date.now() }, { upsert: true });
  res.json({ ok: true, prefs });
});

module.exports = router;
