const express = require('express');
const Request = require('../models/Request');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { recalculateGroupPoints } = require('./stylists');
const Activity = require('../models/Activity');
const { postSystemMessage, identifyActor } = require('./messages');
const { notify } = require('./notifications');
const Conversation = require('../models/Conversation');
const Customer = require('../models/Customer');
const { markInviteEarned } = require('../lib/invites');
const StyleRecord = require('../models/StyleRecord');
const Referral = require('../models/Referral');
const Stylist = require('../models/Stylist');

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

// Customer contact details and free-text notes are private. They are only
// ever returned to the people involved in that specific request.
// `emergency` is the customer's emergency contact (a name and phone number of
// someone who knows where they're going), so it's a third person's details.
const CONTACT_FIELDS = ['clientName', 'clientPhone', 'clientId', 'emergency'];
const DETAIL_FIELDS = ['note', 'area', 'budget'];
function redact(r, fields) {
  const o = r.toObject ? r.toObject() : { ...r };
  for (const f of fields) delete o[f];
  return o;
}

// Requests, scoped to who is asking:
//  - admin: everything
//  - professional: full details for their own shop (and shops they have
//    staff access to); for unclaimed open requests, what they need to decide
//    (area, budget, note) but NOT the customer's name or phone until claimed
//  - customer: full details of their own requests
//  - anyone else: status/service information only, no personal details.
// Previously this returned every customer's name and phone number publicly.
router.get('/', async (req, res) => {
  try {
    const actor = identifyActor(req);
    const list = await Request.find({});
    if (actor && actor.type === 'stylist' && actor.isAdmin) return res.json(list);
    const myShops = new Set();
    if (actor && actor.type === 'stylist') {
      myShops.add(actor.id);
      const managed = await Stylist.find({ 'staffAccess.stylistId': actor.id }, '_id');
      managed.forEach((s) => myShops.add(s._id.toString()));
    }
    res.json(list.map((r) => {
      const isMineAsCustomer = actor && actor.type === 'customer' && r.clientId === actor.id;
      const isMineAsPro = actor && actor.type === 'stylist' && r.stylistId && myShops.has(r.stylistId);
      if (isMineAsCustomer || isMineAsPro) return r;
      if (actor && actor.type === 'stylist' && !r.stylistId && r.status === 'open') return redact(r, CONTACT_FIELDS);
      return redact(r, [...CONTACT_FIELDS, ...DETAIL_FIELDS]);
    }));
  } catch (e) {
    res.status(500).json({ error: 'Could not load requests.' });
  }
});

const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : undefined);

// Submit a booking request to a specific professional (or an open request).
router.post('/', async (req, res) => {
  try {
    const { stylistId, styleId, clientId, meet, emergency, ref } = req.body;
    const clientName = clip(req.body.clientName, 100);
    const clientPhone = clip(req.body.clientPhone, 30);
    const date = clip(req.body.date, 100);
    const note = clip(req.body.note, 1000);
    const budget = clip(req.body.budget, 50);
    const area = clip(req.body.area, 100);
    if (!clientName || !clientPhone) return res.status(400).json({ error: 'Name and phone are required.' });

    // Real appointment time (for "who's coming today" and the calendar).
    // Must be a real moment within the next year; the free-text `date` stays
    // for display and for older clients that don't send this.
    let preferredAt = null;
    if (req.body.preferredAt !== undefined && req.body.preferredAt !== null) {
      const t = Number(req.body.preferredAt);
      const now = Date.now();
      if (!Number.isFinite(t) || t < now - 60 * 60 * 1000 || t > now + 366 * 24 * 60 * 60 * 1000) {
        return res.status(400).json({ error: 'Please choose a date and time in the future.' });
      }
      preferredAt = t;
    }

    // If this request claims to come from a real customer account, the
    // sender must actually be logged in as that customer. Otherwise anyone
    // could create requests (and conversations) in someone else's name.
    if (clientId) {
      let isRealCustomer = false;
      try { isRealCustomer = !!(await Customer.exists({ _id: clientId })); } catch (e) { /* anonymous browser id */ }
      if (isRealCustomer) {
        const actor = identifyActor(req);
        if (!actor || actor.type !== 'customer' || actor.id !== clientId) {
          return res.status(401).json({ error: 'Please log in to send a request from your account.' });
        }
      }
    }

    const status = stylistId ? 'pending' : 'open'; // no stylistId = open/broadcast request
    let serviceNameSnapshot = null, priceSnapshot = null, durationSnapshot = null, currencySnapshot = 'GHS';
    if (stylistId) {
      let st = null;
      try { st = await Stylist.findById(stylistId); } catch (e) { /* malformed id */ }
      if (!st) return res.status(404).json({ error: 'That shop no longer exists.' });
      if (st.status !== 'APPROVED' || (st.accountStatus && st.accountStatus !== 'ACTIVE')) {
        return res.status(400).json({ error: 'This shop isn\u2019t accepting requests yet.' });
      }
      if (st.availability === 'UNAVAILABLE' || st.availability === 'AWAY') {
        return res.status(400).json({ error: 'This professional isn\u2019t taking requests right now.' });
      }
      currencySnapshot = st.currency || 'GHS';
      const style = styleId && (st.styles || []).find((s) => s.id === styleId && s.active !== false);
      if (styleId && !style) return res.status(400).json({ error: 'That service is no longer offered.' });
      if (style) { serviceNameSnapshot = style.name; priceSnapshot = style.price; durationSnapshot = style.duration; }
    }

    const r = await Request.create({ stylistId, styleId, serviceNameSnapshot, priceSnapshot, durationSnapshot, currencySnapshot, clientId, clientName, clientPhone, date, preferredAt, note, meet, emergency, budget, area, status });
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
    // logged-in Customer account (verified above).
    if (stylistId && clientId) {
      try {
        const customer = await Customer.findById(clientId);
        if (customer) {
          let conv = await Conversation.findOne({ customerId: clientId, stylistId });
          if (!conv) conv = await Conversation.create({ customerId: clientId, customerName: customer.name, stylistId, requestId: r._id.toString(), stylistUnread: true });
          else { conv.requestId = r._id.toString(); conv.stylistUnread = true; conv.lastMessageAt = Date.now(); await conv.save(); }
        }
      } catch (e) { /* anonymous booking path */ }
    }
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: 'Could not send the request. Please try again.' });
  }
});

// The only moves a booking can make. Anything else is refused, so a request
// can't jump straight to "completed" or be completed twice.
const TRANSITIONS = { pending: ['accepted', 'declined'], accepted: ['completed', 'declined'] };

// Auth: professional (owner, authorised staff, or admin) moves a request on.
router.put('/:id/status', requireAuth, async (req, res) => {
  try {
  let current;
  try { current = await Request.findById(req.params.id); } catch (e) { return res.status(404).json({ error: 'Request not found.' }); }
  if (!current) return res.status(404).json({ error: 'Request not found.' });
  const isOwner = current.stylistId === req.stylistId;
  const isAuthorizedStaff = !isOwner && current.stylistId && await Stylist.exists({ _id: current.stylistId, 'staffAccess.stylistId': req.stylistId });
  if (!isOwner && !isAuthorizedStaff && !req.isAdmin) return res.status(403).json({ error: 'Not your request.' });
  const next = req.body.status;
  if (!(TRANSITIONS[current.status] || []).includes(next)) {
    return res.status(400).json({ error: `A ${current.status} request can’t be changed to ${next}.` });
  }
  // Atomic: only succeeds if nobody changed this request since we read it.
  const r = await Request.findOneAndUpdate(
    { _id: current._id, status: current.status },
    { status: next, updatedAt: Date.now() },
    { new: true }
  );
  if (!r) return res.status(409).json({ error: 'This request was just updated. Refresh to see its latest status.' });
  if (next === 'accepted' && r.stylistId) {
    try { await Activity.create({ stylistId: r.stylistId, type: 'REQUEST_ACCEPTED', meta: { requestId: r._id.toString() } }); } catch (e) { /* non-fatal */ }
    await postSystemMessage(r._id.toString(), 'request_accepted', { requestId: r._id.toString() });
    await notifyRealCustomer(r.clientId, { type: 'REQUEST_ACCEPTED', title: 'Your request was accepted', entityType: 'request', entityId: r._id.toString(), priority: 'important' });
  }
  if (next === 'declined' && r.stylistId) {
    await postSystemMessage(r._id.toString(), 'request_declined', { requestId: r._id.toString() });
    await notifyRealCustomer(r.clientId, { type: 'REQUEST_DECLINED', title: 'Your request was declined', entityType: 'request', entityId: r._id.toString(), priority: 'normal' });
  }
  if (next === 'completed' && r.stylistId) {
    try { await Activity.create({ stylistId: r.stylistId, type: 'SERVICE_COMPLETED', meta: { requestId: r._id.toString() } }); } catch (e) { /* non-fatal */ }
    await recalculateGroupPoints(r.stylistId);
    await postSystemMessage(r._id.toString(), 'service_completed', { requestId: r._id.toString(), styleId: r.styleId, date: r.date });
    await notifyRealCustomer(r.clientId, { type: 'SERVICE_COMPLETED', title: 'Your service is complete', entityType: 'request', entityId: r._id.toString(), priority: 'normal' });
    // Invite rewards: if the customer or the professional on this job joined
    // through someone's code, this may be their first completed job.
    try { await markInviteEarned(r, { Stylist, Customer, notify }); } catch (e) { /* non-fatal: rewards never block a completion */ }
    // The real Style Record foundation, finally built — created only for a
    // genuine logged-in customer (same honest rule as everywhere else
    // tonight: an anonymous booker's record would be unreadable by anyone).
    // Never duplicated: requestId is unique, so a retried status update
    // can't create a second record for the same completion.
    if (r.clientId) {
      try {
        const customer = await Customer.findById(r.clientId);
        if (customer) {
          await StyleRecord.create({
            customerId: r.clientId, stylistId: r.stylistId, requestId: r._id.toString(), styleId: r.styleId,
            serviceName: r.serviceNameSnapshot, price: r.priceSnapshot, duration: r.durationSnapshot,
            currency: r.currencySnapshot || 'GHS', completedAt: Date.now(),
          });
        }
      } catch (e) { /* duplicate requestId on retry, or not a real customer — either way, non-fatal */ }
    }
  }
  res.json(r);
  } catch (e) {
    res.status(500).json({ error: 'Could not update the request.' });
  }
});

// Professional claims an open (unassigned) request. Atomic: only works while
// the request is still open and unassigned, so nobody can take a booking that
// already belongs to another professional.
router.put('/:id/claim', requireAuth, async (req, res) => {
  try {
    const me = await Stylist.findById(req.stylistId);
    if (!me || me.status !== 'APPROVED' || (me.accountStatus && me.accountStatus !== 'ACTIVE')) {
      return res.status(403).json({ error: 'Only approved, active professionals can take open requests.' });
    }
    let r = null;
    try {
      r = await Request.findOneAndUpdate(
        { _id: req.params.id, status: 'open', stylistId: null },
        { stylistId: req.stylistId, status: 'pending', updatedAt: Date.now() },
        { new: true }
      );
    } catch (e) { return res.status(404).json({ error: 'Request not found.' }); }
    if (!r) return res.status(409).json({ error: 'This request has already been taken or is no longer open.' });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: 'Could not claim the request.' });
  }
});

// The customer rates a completed service, once. Proof of being that
// customer: a logged-in customer account, or (for older anonymous bookings)
// the private browser id the booking was made with, which is never exposed
// publicly anymore.
router.put('/:id/rate', async (req, res) => {
  try {
    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be a whole number from 1 to 5.' });
    let current;
    try { current = await Request.findById(req.params.id); } catch (e) { return res.status(404).json({ error: 'Request not found.' }); }
    if (!current) return res.status(404).json({ error: 'Request not found.' });
    const actor = identifyActor(req);
    const isCustomerOwner = actor && actor.type === 'customer' && current.clientId && current.clientId === actor.id;
    const isAnonOwner = !!current.clientId && typeof req.body.clientId === 'string' && req.body.clientId === current.clientId;
    if (!isCustomerOwner && !isAnonOwner) return res.status(403).json({ error: 'Only the customer who booked this service can rate it.' });
    if (current.status !== 'completed') return res.status(400).json({ error: 'You can rate a service once it’s completed.' });
    // Atomic: only the first rating counts.
    const r = await Request.findOneAndUpdate(
      { _id: current._id, status: 'completed', rating: null },
      { rating, updatedAt: Date.now() },
      { new: true }
    );
    if (!r) return res.status(409).json({ error: 'This service has already been rated.' });
    if (r.stylistId) {
      try { await Activity.create({ stylistId: r.stylistId, type: 'RATING_RECEIVED', meta: { requestId: r._id.toString(), rating } }); } catch (e) { /* non-fatal */ }
      await notify({ recipientId: r.stylistId, recipientType: 'stylist', type: 'RATING_RECEIVED', title: `You received a ${rating}-star rating`, entityType: 'request', entityId: r._id.toString(), priority: 'normal' });
    }
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: 'Could not save the rating.' });
  }
});

module.exports = router;
