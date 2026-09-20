const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Customer = require('../models/Customer');
const { requireCustomerAuth } = require('../middleware/auth');
const Activity = require('../models/Activity');
const SavedStyle = require('../models/SavedStyle');
const SavingsGoal = require('../models/SavingsGoal');
const Stylist = require('../models/Stylist');
const Request = require('../models/Request');
const Conversation = require('../models/Conversation');
const { notify } = require('./notifications');

const router = express.Router();

function makeToken(customer) {
  // 90-day expiry, longer than a stylist's 30 — a customer coming back
  // "months later" is the entire point of this feature, so their session
  // should genuinely outlast a single visit cycle.
  return jwt.sign({ id: customer._id.toString(), role: 'customer' }, process.env.JWT_SECRET, { expiresIn: '90d' });
}
function publicCustomer(c) {
  const obj = c.toObject ? c.toObject() : c;
  delete obj.passwordHash;
  return obj;
}

router.post('/register', async (req, res) => {
  try {
    const { phone, password, name } = req.body;
    if (!phone || !password || !name) return res.status(400).json({ error: 'Phone, password, and name are required.' });
    const existing = await Customer.findOne({ phone });
    if (existing) return res.status(400).json({ error: 'An account with this phone number already exists.' });
    const passwordHash = await bcrypt.hash(password, 10);
    const customer = await Customer.create({ phone, passwordHash, name });
    try { await Activity.create({ clientId: customer._id.toString(), type: 'ACCOUNT_CREATED', meta: { role: 'customer' } }); } catch (e) { /* non-fatal */ }
    res.json({ token: makeToken(customer), customer: publicCustomer(customer) });
  } catch (e) {
    res.status(500).json({ error: 'Could not create account.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const customer = await Customer.findOne({ phone });
    if (!customer) return res.status(401).json({ error: 'No account found with that phone number.' });
    const ok = await bcrypt.compare(password, customer.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Incorrect password.' });
    res.json({ token: makeToken(customer), customer: publicCustomer(customer) });
  } catch (e) {
    res.status(500).json({ error: 'Login failed.' });
  }
});

router.get('/me', requireCustomerAuth, async (req, res) => {
  const c = await Customer.findById(req.customerId);
  if (!c) return res.status(404).json({ error: 'Not found.' });
  res.json(publicCustomer(c));
});

// Update the one real editable profile field that currently exists.
router.put('/me', requireCustomerAuth, async (req, res) => {
  const { name } = req.body;
  const c = await Customer.findById(req.customerId);
  if (!c) return res.status(404).json({ error: 'Not found.' });
  if (name !== undefined && name.trim()) c.name = name.trim();
  await c.save();
  res.json(publicCustomer(c));
});

// ---------- Saved Styles: genuinely new, customer-owned ----------
router.get('/me/styles', requireCustomerAuth, async (req, res) => {
  const list = await SavedStyle.find({ customerId: req.customerId }).sort({ createdAt: -1 });
  res.json(list);
});
router.post('/me/styles', requireCustomerAuth, async (req, res) => {
  const { name, category, photo, notes, sourceRequestId } = req.body;
  if (!name) return res.status(400).json({ error: 'A style name is required.' });
  // If saved from a real completed request, verify it's genuinely this
  // customer's own request — never trust an arbitrary id from the frontend.
  if (sourceRequestId) {
    const r = await Request.findById(sourceRequestId).catch(() => null);
    if (!r || r.clientId !== req.customerId) return res.status(403).json({ error: 'Not your service record.' });
  }
  const style = await SavedStyle.create({ customerId: req.customerId, name, category, photo, notes, sourceRequestId: sourceRequestId || null });
  try { await Activity.create({ clientId: req.customerId, type: 'STYLE_SAVED', meta: { styleId: style._id.toString() } }); } catch (e) { /* non-fatal */ }
  res.json(style);
});
router.patch('/me/styles/:id', requireCustomerAuth, async (req, res) => {
  const style = await SavedStyle.findById(req.params.id);
  if (!style || style.customerId !== req.customerId) return res.status(404).json({ error: 'Not found.' });
  const { name, category, notes, photo } = req.body;
  if (name !== undefined) style.name = name;
  if (category !== undefined) style.category = category;
  if (notes !== undefined) style.notes = notes;
  if (photo !== undefined) style.photo = photo;
  await style.save();
  res.json(style);
});
router.delete('/me/styles/:id', requireCustomerAuth, async (req, res) => {
  const style = await SavedStyle.findById(req.params.id);
  if (!style || style.customerId !== req.customerId) return res.status(404).json({ error: 'Not found.' });
  await style.deleteOne();
  res.json({ ok: true });
});

// ---------- Saved/followed shops: reuses the EXISTING follow mechanism on
// Stylist.followers — no new model, this is just this customer's own view
// of data that already exists. ----------
router.get('/me/following', requireCustomerAuth, async (req, res) => {
  const shops = await Stylist.find({ followers: req.customerId, status: 'APPROVED' });
  res.json(shops.map(s => { const o = s.toObject(); delete o.passwordHash; return o; }));
});

// ---------- Real service history — reuses the EXISTING Request model
// (with the historical price/duration/name snapshots already added), no
// separate Service Record model invented. ----------
router.get('/me/history', requireCustomerAuth, async (req, res) => {
  const requests = await Request.find({ clientId: req.customerId }).sort({ updatedAt: -1 });
  res.json(requests);
});

// "Book This Again" — uses the OLD request only as a starting point for
// which shop/style to pre-fill; price and duration come fresh from the
// style's CURRENT configuration, never the historical snapshot, since a
// new booking must reflect what the shop actually charges today.
router.post('/me/book-again/:requestId', requireCustomerAuth, async (req, res) => {
  const old = await Request.findById(req.params.requestId);
  if (!old || old.clientId !== req.customerId) return res.status(403).json({ error: 'Not your service record.' });
  if (!old.stylistId) return res.status(400).json({ error: 'That was an open request with no specific shop.' });
  const stylist = await Stylist.findById(old.stylistId);
  if (!stylist) return res.status(404).json({ error: 'That shop is no longer available.' });
  const currentStyle = old.styleId ? (stylist.styles || []).find(s => s.id === old.styleId && s.active !== false) : null;
  const customer = await Customer.findById(req.customerId);
  const { date, note, meet, emergency, budget, area } = req.body;
  const r = await Request.create({
    stylistId: old.stylistId,
    styleId: currentStyle ? currentStyle.id : null,
    serviceNameSnapshot: currentStyle ? currentStyle.name : old.serviceNameSnapshot,
    priceSnapshot: currentStyle ? currentStyle.price : null, // no current style match → no invented price
    durationSnapshot: currentStyle ? currentStyle.duration : null,
    currencySnapshot: stylist.currency || 'GHS', // current shop currency, not the old request's stale one
    clientId: req.customerId,
    clientName: customer ? customer.name : old.clientName,
    clientPhone: old.clientPhone,
    date, note, meet, emergency, budget, area,
    status: 'pending',
  });
  try { await Activity.create({ stylistId: old.stylistId, clientId: req.customerId, type: 'REQUEST_CREATED', meta: { requestId: r._id.toString(), bookAgain: true } }); } catch (e) { /* non-fatal */ }
  await notify({ recipientId: old.stylistId, recipientType: 'stylist', type: 'REQUEST_CREATED', title: `${r.clientName} wants to book again`, message: r.serviceNameSnapshot, entityType: 'request', entityId: r._id.toString(), priority: 'action_required' });
  try {
    let conv = await Conversation.findOne({ customerId: req.customerId, stylistId: old.stylistId });
    if (!conv) conv = await Conversation.create({ customerId: req.customerId, customerName: customer ? customer.name : null, stylistId: old.stylistId, requestId: r._id.toString(), stylistUnread: true });
    else { conv.requestId = r._id.toString(); conv.stylistUnread = true; conv.lastMessageAt = Date.now(); await conv.save(); }
  } catch (e) { /* non-fatal */ }
  res.json(r);
});

// ---------- Savings goals: a personal planning tool, NOT a wallet. No
// money moves because of these routes — see the model's own comment. ----------
router.get('/me/savings-goals', requireCustomerAuth, async (req, res) => {
  const list = await SavingsGoal.find({ customerId: req.customerId }).sort({ createdAt: -1 });
  res.json(list);
});
router.post('/me/savings-goals', requireCustomerAuth, async (req, res) => {
  const { label, targetAmountMinor, currency, stylistId, styleId, note } = req.body;
  if (!label || !targetAmountMinor) return res.status(400).json({ error: 'A label and target amount are required.' });
  const goal = await SavingsGoal.create({ customerId: req.customerId, label, targetAmountMinor, currency: currency || 'GHS', stylistId: stylistId || null, styleId: styleId || null, note: note || null });
  res.json(goal);
});
router.delete('/me/savings-goals/:id', requireCustomerAuth, async (req, res) => {
  const goal = await SavingsGoal.findById(req.params.id);
  if (!goal || goal.customerId !== req.customerId) return res.status(404).json({ error: 'Not found.' });
  await goal.deleteOne();
  res.json({ ok: true });
});

module.exports = router;
