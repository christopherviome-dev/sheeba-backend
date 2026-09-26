const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Customer = require('../models/Customer');
const { requireCustomerAuth } = require('../middleware/auth');
const Activity = require('../models/Activity');
const SavedStyle = require('../models/SavedStyle');
const SavingsGoal = require('../models/SavingsGoal');
const StyleRecord = require('../models/StyleRecord');
const RepeatPreference = require('../models/RepeatPreference');
const Stylist = require('../models/Stylist');
const Request = require('../models/Request');
const Conversation = require('../models/Conversation');
const { notify } = require('./notifications');
const { phoneCandidates, checkNewPassword, canonicalPhone } = require('../lib/passwords');
const { uniqueCode, ensureCode } = require('../lib/codes');
const { recordInvite } = require('../lib/invites');
const { checkCountry } = require('../lib/countries');

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
    const existing = await Customer.findOne({ phone: { $in: phoneCandidates(phone) } });
    if (existing) return res.status(400).json({ error: 'An account with this phone number already exists.' });
    const passwordHash = await bcrypt.hash(password, 10);
    const countryCheck = checkCountry(req.body.country);
    if (!countryCheck.ok) return res.status(400).json({ error: countryCheck.error });
    const customer = await Customer.create({ phone: canonicalPhone(phone), passwordHash, name, code: await uniqueCode(Stylist, Customer), country: countryCheck.value });
    await recordInvite({ inviteCode: req.body.inviteCode, newType: 'customer', newDoc: customer, Stylist, Customer, notify });
    try { await Activity.create({ clientId: customer._id.toString(), type: 'ACCOUNT_CREATED', meta: { role: 'customer' } }); } catch (e) { /* non-fatal */ }
    res.json({ token: makeToken(customer), customer: publicCustomer(customer) });
  } catch (e) {
    res.status(500).json({ error: 'Could not create account.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const customer = await Customer.findOne({ phone: { $in: phoneCandidates(phone) } });
    if (!customer) return res.status(401).json({ error: 'No account found with that phone number.' });
    const ok = await bcrypt.compare(password, customer.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Incorrect password.' });
    res.json({ token: makeToken(customer), customer: publicCustomer(customer) });
  } catch (e) {
    res.status(500).json({ error: 'Login failed.' });
  }
});

// A logged-in customer changes their own password (current one required).
router.post('/me/change-password', requireCustomerAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const problem = checkNewPassword(newPassword);
  if (problem) return res.status(400).json({ error: problem });
  const customer = await Customer.findById(req.customerId);
  if (!customer) return res.status(404).json({ error: 'Account not found.' });
  const ok = typeof currentPassword === 'string' && await bcrypt.compare(currentPassword, customer.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Your current password is incorrect.' });
  if (await bcrypt.compare(newPassword, customer.passwordHash)) return res.status(400).json({ error: 'Choose a password different from the current one.' });
  customer.passwordHash = await bcrypt.hash(newPassword, 10);
  customer.mustChangePassword = false;
  customer.passwordChangedAt = Date.now();
  await customer.save();
  res.json({ ok: true });
});

router.get('/me', requireCustomerAuth, async (req, res) => {
  const c = await Customer.findById(req.customerId);
  if (!c) return res.status(404).json({ error: 'Not found.' });
  try { await ensureCode(c, Stylist, Customer); } catch (e) { /* a code can be made next time */ }
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

// ---------- Style Records: real, automatically created service history —
// see routes/requests.js for where these are actually created. ----------
router.get('/me/style-records', requireCustomerAuth, async (req, res) => {
  const list = await StyleRecord.find({ customerId: req.customerId }).sort({ completedAt: -1 });
  res.json(list);
});

// "Save This Style" — the customer attaches the actual finished-result
// photo and any notes to their own real completed service. Never lets the
// customer attach a photo to someone else's record.
router.patch('/me/style-records/:id', requireCustomerAuth, async (req, res) => {
  const record = await StyleRecord.findById(req.params.id);
  if (!record || record.customerId !== req.customerId) return res.status(404).json({ error: 'Not found.' });
  const { finishedPhoto, notes } = req.body;
  if (finishedPhoto !== undefined) record.finishedPhoto = finishedPhoto;
  if (notes !== undefined) record.notes = notes;
  await record.save();
  res.json(record);
});

// Convenience for the customer's History view, which has requestId on
// hand, not the StyleRecord's own id — finds the real record created
// automatically at completion and attaches the finished photo/notes to it.
router.patch('/me/style-records/by-request/:requestId', requireCustomerAuth, async (req, res) => {
  const record = await StyleRecord.findOne({ requestId: req.params.requestId, customerId: req.customerId });
  if (!record) return res.status(404).json({ error: 'No style record found for that service yet.' });
  const { finishedPhoto, notes } = req.body;
  if (finishedPhoto !== undefined) record.finishedPhoto = finishedPhoto;
  if (notes !== undefined) record.notes = notes;
  try { await Activity.create({ clientId: req.customerId, type: 'STYLE_SAVED', meta: { styleRecordId: record._id.toString() } }); } catch (e) { /* non-fatal */ }
  await record.save();
  res.json(record);
});

// ---------- Repeat preferences: customer-chosen, never inferred ----------
router.post('/me/repeat-preferences', requireCustomerAuth, async (req, res) => {
  const { stylistId, styleId, serviceName, intervalDays, lastCompletedAt } = req.body;
  if (!stylistId || !intervalDays) return res.status(400).json({ error: 'A shop and an interval are required.' });
  const pref = await RepeatPreference.findOneAndUpdate(
    { customerId: req.customerId, stylistId, styleId: styleId || null },
    { serviceName, intervalDays, lastCompletedAt: lastCompletedAt || Date.now(), updatedAt: Date.now(), remindersEnabled: true, lastNotifiedStatus: null },
    { upsert: true, new: true }
  );
  res.json(pref);
});

router.get('/me/repeat-preferences', requireCustomerAuth, async (req, res) => {
  const list = await RepeatPreference.find({ customerId: req.customerId });
  const withStatus = await Promise.all(list.map(async p => {
    const computed = RepeatPreference.computeStatus(p);
    // Notify only when the status has genuinely changed since the last
    // time we notified for this preference — this is the real dedup: a
    // customer refreshing this page a hundred times in one day can never
    // generate a hundred notifications for the same due date.
    if (p.remindersEnabled && ['APPROACHING', 'DUE', 'OVERDUE'].includes(computed.status) && computed.status !== p.lastNotifiedStatus) {
      try {
        const notifType = computed.status === 'OVERDUE' ? 'SERVICE_OVERDUE' : 'SERVICE_DUE_SOON';
        await notify({ recipientId: req.customerId, recipientType: 'customer', type: notifType, title: `Your ${p.serviceName || 'usual service'} may be ${computed.status.toLowerCase()}`, message: computed.daysUntilDue >= 0 ? `${computed.daysUntilDue} day(s) to go` : `${-computed.daysUntilDue} day(s) overdue`, entityType: 'shop', entityId: p.stylistId, priority: computed.status === 'OVERDUE' ? 'time_sensitive' : 'normal' });
        await notify({ recipientId: p.stylistId, recipientType: 'stylist', type: notifType, title: `A customer may be due for ${p.serviceName || 'a repeat service'} soon`, entityType: 'shop', entityId: p.stylistId, priority: 'normal' });
        p.lastNotifiedStatus = computed.status;
        await p.save();
      } catch (e) { /* non-fatal — status still displays correctly even if the notification failed */ }
    }
    return { ...p.toObject(), ...computed };
  }));
  res.json(withStatus);
});

router.put('/me/repeat-preferences/:id', requireCustomerAuth, async (req, res) => {
  const pref = await RepeatPreference.findById(req.params.id);
  if (!pref || pref.customerId !== req.customerId) return res.status(404).json({ error: 'Not found.' });
  const { intervalDays, remindersEnabled } = req.body;
  if (intervalDays !== undefined) pref.intervalDays = intervalDays;
  if (remindersEnabled !== undefined) pref.remindersEnabled = remindersEnabled;
  pref.updatedAt = Date.now();
  await pref.save();
  res.json({ ...pref.toObject(), ...RepeatPreference.computeStatus(pref) });
});

router.delete('/me/repeat-preferences/:id', requireCustomerAuth, async (req, res) => {
  const pref = await RepeatPreference.findById(req.params.id);
  if (!pref || pref.customerId !== req.customerId) return res.status(404).json({ error: 'Not found.' });
  await pref.deleteOne();
  res.json({ ok: true });
});

module.exports = router;
