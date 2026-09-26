const express = require('express');
const Stylist = require('../models/Stylist');
const Customer = require('../models/Customer');
const Request = require('../models/Request');
const { requireAuth } = require('../middleware/auth');
const { normalizeCode } = require('../lib/codes');
const { notify } = require('./notifications');

const router = express.Router();

// Is this professional allowed to act for this shop? (the owner, or staff the owner authorised)
async function canActFor(stylistId, shopId) {
  if (String(stylistId) === String(shopId)) return true;
  try { return !!(await Stylist.exists({ _id: shopId, 'staffAccess.stylistId': String(stylistId) })); } catch (e) { return false; }
}

// A professional scanned (or typed) a customer's Sheeba code.
// PRIVACY: the customer's name is only revealed if this professional already
// has an appointment with them. Otherwise the reply says so and nothing else,
// so nobody can scan random codes to collect names.
router.get('/:code', requireAuth, async (req, res) => {
  const code = normalizeCode(req.params.code);
  if (!code) return res.status(404).json({ error: 'That isn\u2019t a Sheeba code.' });
  const customer = await Customer.findOne({ code });
  if (!customer) return res.status(404).json({ error: 'That code doesn\u2019t belong to a customer.' });
  const shopIds = [String(req.stylistId)];
  try { (await Stylist.find({ 'staffAccess.stylistId': String(req.stylistId) })).forEach((s) => shopIds.push(s._id.toString())); } catch (e) { /* no staff access */ }
  const since = Date.now() - 2 * 24 * 3600 * 1000;
  const all = await Request.find({ clientId: customer._id.toString() });
  const mine = all.filter((r) => shopIds.includes(String(r.stylistId)) && ['pending', 'accepted'].includes(r.status)
    && (!r.preferredAt || r.preferredAt > since));
  if (mine.length === 0) return res.json({ found: false });
  res.json({
    found: true,
    firstName: String(customer.name || '').trim().split(/\s+/)[0] || 'Customer',
    appointments: mine
      .sort((a, b) => (a.preferredAt || Infinity) - (b.preferredAt || Infinity))
      .map((r) => ({ _id: r._id, service: r.serviceNameSnapshot || 'Service', preferredAt: r.preferredAt || null, date: r.date || null, status: r.status, checkedInAt: r.checkedInAt || null })),
  });
});

// Check the customer in for an accepted appointment. The code must match the
// appointment's customer: it proves they're physically there, showing their phone.
router.post('/:requestId', requireAuth, async (req, res) => {
  const code = normalizeCode(req.body.code);
  if (!code) return res.status(400).json({ error: 'The customer\u2019s code is needed to check them in.' });
  let r = null;
  try { r = await Request.findById(req.params.requestId); } catch (e) { /* bad id */ }
  if (!r) return res.status(404).json({ error: 'Appointment not found.' });
  if (!(await canActFor(req.stylistId, r.stylistId))) return res.status(403).json({ error: 'This isn\u2019t your appointment.' });
  const customer = await Customer.findOne({ code });
  if (!customer || String(customer._id) !== String(r.clientId)) return res.status(400).json({ error: 'That code doesn\u2019t match this appointment\u2019s customer.' });
  if (r.status !== 'accepted') return res.status(400).json({ error: 'Accept the appointment first, then check them in.' });
  if (r.checkedInAt) return res.json({ ok: true, checkedInAt: r.checkedInAt, already: true });
  r.checkedInAt = Date.now();
  await r.save();
  const shop = await Stylist.findById(r.stylistId, 'name salonName');
  await notify({ recipientId: String(r.clientId), recipientType: 'customer', type: 'REQUEST_ACCEPTED', title: `You're checked in at ${shop ? (shop.salonName || shop.name) : 'your appointment'}`, message: r.serviceNameSnapshot || '', entityType: 'request', entityId: r._id.toString(), priority: 'normal' });
  res.json({ ok: true, checkedInAt: r.checkedInAt });
});

module.exports = router;
