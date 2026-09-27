const express = require('express');
const jwt = require('jsonwebtoken');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Stylist = require('../models/Stylist');
const Customer = require('../models/Customer');
const { requireAuth, requireCustomerAuth } = require('../middleware/auth');
const V = require('../lib/validate');
const attempts = require('../lib/attempts');
const findConv = async (id) => { try { return await Conversation.findById(id); } catch (e) { return null; } }; // bad ids → clean 404

const router = express.Router();

// Identifies whether the caller is a logged-in customer or a logged-in
// stylist, from whichever kind of token they present — needed because a
// conversation has two different kinds of participant, each with their own
// existing auth system. Never trusts a body-supplied id for who "you" are.
function identifyActor(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role === 'customer') return { type: 'customer', id: payload.id };
    return { type: 'stylist', id: payload.id, isAdmin: !!payload.isAdmin };
  } catch (e) {
    return null;
  }
}

function isParticipant(actor, conv) {
  if (!actor) return false;
  if (actor.type === 'stylist' && actor.isAdmin) return true; // admin can view for moderation/support
  if (actor.type === 'customer') return conv.customerId === actor.id;
  if (actor.type === 'stylist') return conv.stylistId === actor.id;
  return false;
}

// Customer: start (or reuse) a conversation with a stylist. One conversation
// per customer+stylist pair, reused across every future request — the
// relationship is ongoing, not one conversation per booking.
router.post('/conversations', requireCustomerAuth, async (req, res) => {
  const { stylistId, requestId } = req.body;
  if (!stylistId) return res.status(400).json({ error: 'Missing stylistId.' });
  let stylist = null;
  try { stylist = await Stylist.findById(stylistId); } catch (e) { /* bad id */ }
  // Only live shops can be messaged.
  if (!stylist || stylist.status !== 'APPROVED' || (stylist.accountStatus || 'ACTIVE') !== 'ACTIVE') return res.status(404).json({ error: 'Shop not found.' });
  const customer = await Customer.findById(req.customerId);
  if (!customer || (customer.accountStatus || 'ACTIVE') !== 'ACTIVE') return res.status(403).json({ error: 'Your account can\u2019t send messages right now.' });
  let conv = await Conversation.findOne({ customerId: req.customerId, stylistId });
  if (!conv) {
    // At most 10 NEW conversations in 24 hours per customer (counted in the
    // database, so it really is per day): stops spamming many shops.
    const today = await Conversation.countDocuments({ customerId: req.customerId, createdAt: { $gte: new Date(Date.now() - 24 * 3600 * 1000) } }); // a Date: the field is stored as one
    if (today >= 10) return res.status(429).json({ error: 'You\u2019ve started a lot of new conversations today. Please try again tomorrow.' });
    conv = await Conversation.create({ customerId: req.customerId, customerName: customer ? customer.name : null, stylistId, requestId: requestId || null, stylistUnread: true });
  } else if (requestId && conv.requestId !== requestId) {
    conv.requestId = requestId; // keep pointing at the most recent real request
    await conv.save();
  }
  res.json(conv);
});

router.get('/conversations/customer', requireCustomerAuth, async (req, res) => {
  const list = await Conversation.find({ customerId: req.customerId }).sort({ lastMessageAt: -1 });
  // Each shop's NAME only (one lean lookup), so the list reads well.
  const ids = [...new Set(list.map((c) => c.stylistId).filter(Boolean))];
  const shops = ids.length ? await Stylist.find({ _id: { $in: ids } }, 'name salonName') : [];
  const byId = Object.fromEntries(shops.map((s) => [s._id.toString(), s.salonName || s.name]));
  res.json(list.map((c) => ({ ...(c.toObject ? c.toObject() : c), stylistName: byId[String(c.stylistId)] || 'A Sheeba shop' })));
});

router.get('/conversations/stylist', requireAuth, async (req, res) => {
  const list = await Conversation.find({ stylistId: req.stylistId }).sort({ lastMessageAt: -1 });
  res.json(list);
});

router.get('/conversations/:id', async (req, res) => {
  const actor = identifyActor(req);
  const conv = await findConv(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Not found.' });
  if (!isParticipant(actor, conv)) return res.status(403).json({ error: 'Not authorized.' });
  res.json(conv);
});

router.get('/conversations/:id/messages', async (req, res) => {
  const actor = identifyActor(req);
  const conv = await findConv(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Not found.' });
  if (!isParticipant(actor, conv)) return res.status(403).json({ error: 'Not authorized.' });
  const messages = await Message.find({ conversationId: conv._id.toString() }).sort({ createdAt: 1 });
  res.json(messages);
});

// Send a real text or photo message. Structured messages (request accepted,
// service completed) are never created from here — only automatically, by
// routes/requests.js, when the real underlying record actually changes.
router.post('/conversations/:id/messages', async (req, res) => {
  const actor = identifyActor(req);
  const conv = await findConv(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Not found.' });
  // Deliberately stricter than isParticipant() above: admin can VIEW a
  // conversation for moderation, but must never be able to SEND as if they
  // were the customer or the stylist — that would let an admin token
  // impersonate a real participant.
  const isRealParticipant = (actor && actor.type === 'customer' && conv.customerId === actor.id)
    || (actor && actor.type === 'stylist' && conv.stylistId === actor.id);
  if (!isRealParticipant) return res.status(403).json({ error: 'Not authorized.' });
  // Restricted or suspended accounts can't send messages.
  const Me = actor.type === 'customer' ? Customer : Stylist;
  const me = await Me.findById(actor.id, 'accountStatus');
  if (!me || (me.accountStatus || 'ACTIVE') !== 'ACTIVE') return res.status(403).json({ error: 'Your account can\u2019t send messages right now.' });
  // At most 30 messages per 15 minutes from one sender (then a 15-minute pause): stops flooding.
  const k = `msg:${actor.type}:${actor.id}`;
  if (attempts.status([k]).blocked) return res.status(429).json({ error: 'You\u2019re sending messages very quickly. Please wait a few minutes.' });
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  if (text.length > 2000) return res.status(400).json({ error: 'Please keep messages under 2,000 characters.' });
  let photo = null;
  if (req.body.photo !== undefined && req.body.photo !== null && req.body.photo !== '') {
    const p = V.photo(req.body.photo, 'service'); // a real uploaded image, within the size limit
    if (!p.ok) return res.status(400).json({ error: p.error });
    photo = p.value;
  }
  if (!text && !photo) return res.status(400).json({ error: 'Message needs text or a photo.' });
  attempts.fail([[k, 30]]);
  const msg = await Message.create({
    conversationId: conv._id.toString(),
    senderType: actor.type,
    senderId: actor.id,
    messageType: photo ? 'photo' : 'text',
    text: text || null,
    photo: photo || null,
  });
  conv.lastMessageAt = Date.now();
  if (actor.type === 'customer') conv.stylistUnread = true; else conv.customerUnread = true;
  await conv.save();
  // Lazy require: notifications.js itself requires this file (for
  // identifyActor), so requiring it at the top of this file would create a
  // circular require that resolves to an incomplete module. Requiring it
  // here, at call time, is safe — by the time any request is handled, both
  // files have already finished loading.
  try {
    const { notify } = require('./notifications');
    if (actor.type === 'customer') {
      await notify({ recipientId: conv.stylistId, recipientType: 'stylist', type: 'NEW_MESSAGE', title: 'New message', message: text ? text.slice(0, 80) : '📷 Photo', entityType: 'conversation', entityId: conv._id.toString() });
    } else {
      await notify({ recipientId: conv.customerId, recipientType: 'customer', type: 'NEW_MESSAGE', title: 'New message from your stylist', message: text ? text.slice(0, 80) : '📷 Photo', entityType: 'conversation', entityId: conv._id.toString() });
    }
  } catch (e) { /* non-fatal */ }
  res.json(msg);
});

router.put('/conversations/:id/read', async (req, res) => {
  const actor = identifyActor(req);
  const conv = await findConv(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Not found.' });
  const isCustomerSide = actor && actor.type === 'customer' && conv.customerId === actor.id;
  const isStylistSide = actor && actor.type === 'stylist' && conv.stylistId === actor.id;
  if (!isCustomerSide && !isStylistSide) return res.status(403).json({ error: 'Not authorized.' });
  if (isCustomerSide) conv.customerUnread = false; else conv.stylistUnread = false;
  await conv.save();
  res.json(conv);
});

module.exports = router;
module.exports.identifyActor = identifyActor;
module.exports.postSystemMessage = async function postSystemMessage(requestId, structuredType, structuredData) {
  // Called from routes/requests.js on a real status change — finds any
  // conversation already linked to this request and appends a real,
  // system-authored record of what actually happened. If no conversation
  // exists yet, there's nothing to post into; that's fine, it's created
  // lazily the first time the customer actually messages the shop.
  try {
    const conv = await Conversation.findOne({ requestId });
    if (!conv) return;
    await Message.create({ conversationId: conv._id.toString(), senderType: 'system', messageType: 'structured', structuredType, structuredData });
    conv.lastMessageAt = Date.now();
    conv.customerUnread = true;
    await conv.save();
  } catch (e) { /* non-fatal — messaging is a companion to the real record, never a blocker for it */ }
};
