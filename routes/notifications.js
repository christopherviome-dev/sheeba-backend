const express = require('express');
const Notification = require('../models/Notification');
const { identifyActor } = require('./messages');

const router = express.Router();

router.get('/notifications', async (req, res) => {
  const actor = identifyActor(req);
  if (!actor) return res.status(401).json({ error: 'Not logged in.' });
  const list = await Notification.find({ recipientId: actor.id, recipientType: actor.type }).sort({ createdAt: -1 }).limit(50);
  res.json(list);
});

router.get('/notifications/unread-count', async (req, res) => {
  const actor = identifyActor(req);
  if (!actor) return res.status(401).json({ error: 'Not logged in.' });
  const count = await Notification.countDocuments({ recipientId: actor.id, recipientType: actor.type, read: false });
  res.json({ count });
});

router.put('/notifications/:id/read', async (req, res) => {
  const actor = identifyActor(req);
  if (!actor) return res.status(401).json({ error: 'Not logged in.' });
  const n = await Notification.findById(req.params.id);
  if (!n) return res.status(404).json({ error: 'Not found.' });
  // Never trust a recipient id from the frontend — only the actual owner,
  // identified from their own token, can mark their own notification read.
  if (n.recipientId !== actor.id || n.recipientType !== actor.type) return res.status(403).json({ error: 'Not authorized.' });
  n.read = true;
  await n.save();
  res.json(n);
});

router.put('/notifications/read-all', async (req, res) => {
  const actor = identifyActor(req);
  if (!actor) return res.status(401).json({ error: 'Not logged in.' });
  await Notification.updateMany({ recipientId: actor.id, recipientType: actor.type, read: false }, { $set: { read: true } });
  res.json({ ok: true });
});

module.exports = router;

// The single place every other route calls into to create a notification —
// per the architectural principle of one notification engine, not a separate
// reminder system bolted onto messaging, requests, ratings, etc. individually.
module.exports.notify = async function notify({ recipientId, recipientType, type, title, message, entityType, entityId, priority }) {
  if (!recipientId || !recipientType || !type || !title) return;
  try {
    await Notification.create({ recipientId, recipientType, type, title, message: message || null, entityType: entityType || null, entityId: entityId || null, priority: priority || 'normal' });
  } catch (e) { /* non-fatal — a notification failing to write must never block the real underlying action */ }
};

// For admin-facing events (shop under review, report filed): every current
// admin gets one notification. There's no single "admin" identity to attach
// to, and this stays honest about that rather than inventing one.
module.exports.notifyAllAdmins = async function notifyAllAdmins(fields) {
  const Stylist = require('../models/Stylist');
  try {
    const admins = await Stylist.find({ isAdmin: true }, '_id');
    await Promise.all(admins.map(a => module.exports.notify({ ...fields, recipientId: a._id.toString(), recipientType: 'stylist' })));
  } catch (e) { /* non-fatal */ }
};
