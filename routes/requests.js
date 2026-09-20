const express = require('express');
const Request = require('../models/Request');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { recalculateGroupPoints } = require('./stylists');
const Activity = require('../models/Activity');
const { postSystemMessage } = require('./messages');
const { notify } = require('./notifications');
const Conversation = require('../models/Conversation');
const Customer = require('../models/Customer');
const Referral = require('../models/Referral');

const router = express.Router();

// Same real-account check used for conversations above: only notify a
// customer if clientId genuinely resolves to a logged-in account — an
// anonymous browser id could never log in to see the notification anyway.
async function notifyRealCustomer(clientId, fields) {
  if (!clientId) return;
  try {
    const customer = await Customer.findById(clientId);
    if (customer) await notify({ ...fields, recipientId: clientId, recipientType: 'customer' });
  } catch (e) { /* clientId wasn't a real customer id — normal anonymous-booking path */ }
}

// Public: everyone's requests (used by the app to build the live view — kept simple at this scale)
router.get('/', async (req, res) => {
  const list = await Request.find({});
  res.json(list);
});

// Public: submit a booking request to a specific stylist
router.post('/', async (req, res) => {
  const { stylistId, styleId, clientId, clientName, clientPhone, date, note, meet, emergency, budget, area, ref } = req.body;
  if (!clientName || !clientPhone) return res.status(400).json({ error: 'Name and phone are required.' });
  const status = stylistId ? 'pending' : 'open'; // no stylistId = open/broadcast request
  let serviceNameSnapshot = null, priceSnapshot = null, durationSnapshot = null, currencySnapshot = 'GHS';
  if (stylistId) {
    try {
      const st = await require('../models/Stylist').findById(stylistId);
      if (st) currencySnapshot = st.currency || 'GHS';
      const style = styleId && st && (st.styles || []).find(s => s.id === styleId);
      if (style) { serviceNameSnapshot = style.name; priceSnapshot = style.price; durationSnapshot = style.duration; }
    } catch (e) { /* non-fatal — request still gets created without a snapshot */ }
  }
  const r = await Request.create({ stylistId, styleId, serviceNameSnapshot, priceSnapshot, durationSnapshot, currencySnapshot, clientId, clientName, clientPhone, date, note, meet, emergency, budget, area, status });
  if (stylistId) {
    try { await Activity.create({ stylistId, clientId, type: 'REQUEST_CREATED', meta: { requestId: r._id.toString() } }); } catch (e) { /* non-fatal */ }
    await notify({ recipientId: stylistId, recipientType: 'stylist', type: 'REQUEST_CREATED', title: `New request from ${clientName}`, message: note ? note.slice(0, 80) : null, entityType: 'request', entityId: r._id.toString(), priority: 'action_required' });
    // Only a real, active referral code that genuinely belongs to this shop
    // gets credit — never trust an arbitrary frontend-supplied code blindly.
    if (ref) {
      try {
        const referral = await Referral.findOne({ code: ref, stylistId, active: true });
        if (referral) await Activity.create({ stylistId, clientId, type: 'REFERRED_REQUEST_CREATED', meta: { requestId: r._id.toString(), code: ref } });
      } catch (e) { /* non-fatal */ }
    }
  }
  // Only link a real conversation when clientId genuinely resolves to a
  // logged-in Customer account — an anonymous booker's random browser id
  // could never log in to read a conversation tied to it, so we leave
  // anonymous bookings exactly as they've always worked, untouched.
  if (stylistId && clientId) {
    try {
      const customer = await Customer.findById(clientId);
      if (customer) {
        let conv = await Conversation.findOne({ customerId: clientId, stylistId });
        if (!conv) conv = await Conversation.create({ customerId: clientId, customerName: customer.name, stylistId, requestId: r._id.toString(), stylistUnread: true });
        else { conv.requestId = r._id.toString(); conv.stylistUnread = true; conv.lastMessageAt = Date.now(); await conv.save(); }
      }
    } catch (e) { /* clientId wasn't a real customer id — fine, this is the normal anonymous-booking path */ }
  }
  res.json(r);
});

// Auth: stylist accepts/declines/completes one of their own requests
router.put('/:id/status', requireAuth, async (req, res) => {
  const r = await Request.findById(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found.' });
  if (r.stylistId !== req.stylistId && !req.isAdmin) return res.status(403).json({ error: 'Not your request.' });
  r.status = req.body.status;
  r.updatedAt = Date.now();
  await r.save();
  if (r.status === 'accepted' && r.stylistId) {
    try { await Activity.create({ stylistId: r.stylistId, type: 'REQUEST_ACCEPTED', meta: { requestId: r._id.toString() } }); } catch (e) { /* non-fatal */ }
    await postSystemMessage(r._id.toString(), 'request_accepted', { requestId: r._id.toString() });
    await notifyRealCustomer(r.clientId, { type: 'REQUEST_ACCEPTED', title: 'Your request was accepted', entityType: 'request', entityId: r._id.toString(), priority: 'important' });
  }
  if (req.body.status === 'declined' && r.stylistId) {
    await postSystemMessage(r._id.toString(), 'request_declined', { requestId: r._id.toString() });
    await notifyRealCustomer(r.clientId, { type: 'REQUEST_DECLINED', title: 'Your request was declined', entityType: 'request', entityId: r._id.toString(), priority: 'normal' });
  }
  if (req.body.status === 'completed' && r.stylistId) {
    try { await Activity.create({ stylistId: r.stylistId, type: 'SERVICE_COMPLETED', meta: { requestId: r._id.toString() } }); } catch (e) { /* non-fatal */ }
    await recalculateGroupPoints(r.stylistId);
    await postSystemMessage(r._id.toString(), 'service_completed', { requestId: r._id.toString(), styleId: r.styleId, date: r.date });
    await notifyRealCustomer(r.clientId, { type: 'SERVICE_COMPLETED', title: 'Your service is complete', entityType: 'request', entityId: r._id.toString(), priority: 'normal' });
  }
  res.json(r);
});

// Auth: stylist claims an open/broadcast request
router.put('/:id/claim', requireAuth, async (req, res) => {
  const r = await Request.findById(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found.' });
  r.stylistId = req.stylistId;
  r.status = 'pending';
  r.updatedAt = Date.now();
  await r.save();
  res.json(r);
});

// Public: client rates a completed request
router.put('/:id/rate', async (req, res) => {
  const r = await Request.findById(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found.' });
  r.rating = req.body.rating;
  await r.save();
  if (r.stylistId) {
    try { await Activity.create({ stylistId: r.stylistId, type: 'RATING_RECEIVED', meta: { requestId: r._id.toString(), rating: r.rating } }); } catch (e) { /* non-fatal */ }
    await notify({ recipientId: r.stylistId, recipientType: 'stylist', type: 'RATING_RECEIVED', title: `You received a ${r.rating}-star rating`, entityType: 'request', entityId: r._id.toString(), priority: 'normal' });
  }
  res.json(r);
});

module.exports = router;
