const express = require('express');
const jwt = require('jsonwebtoken');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Stylist = require('../models/Stylist');
const Customer = require('../models/Customer');
const { requireAuth, requireCustomerAuth } = require('../middleware/auth');

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
  const stylist = await Stylist.findById(stylistId);
  if (!stylist) return res.status(404).json({ error: 'Shop not found.' });
  let conv = await Conversation.findOne({ customerId: req.customerId, stylistId });
  if (!conv) {
    const customer = await Customer.findById(req.customerId);
    conv = await Conversation.create({ customerId: req.customerId, customerName: customer ? customer.name : null, stylistId, requestId: requestId || null, stylistUnread: true });
  } else if (requestId && conv.requestId !== requestId) {
    conv.requestId = requestId; // keep pointing at the most recent real request
    await conv.save();
  }
  res.json(conv);
});

router.get('/conversations/customer', requireCustomerAuth, async (req, res) => {
  const list = await Conversation.find({ customerId: req.customerId }).sort({ lastMessageAt: -1 });
  res.json(list);
});

router.get('/conversations/stylist', requireAuth, async (req, res) => {
  const list = await Conversation.find({ stylistId: req.stylistId }).sort({ lastMessageAt: -1 });
  res.json(list);
});

router.get('/conversations/:id', async (req, res) => {
  const actor = identifyActor(req);
  const conv = await Conversation.findById(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Not found.' });
  if (!isParticipant(actor, conv)) return res.status(403).json({ error: 'Not authorized.' });
  res.json(conv);
});

router.get('/conversations/:id/messages', async (req, res) => {
  const actor = identifyActor(req);
  const conv = await Conversation.findById(req.params.id);
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
  const conv = await Conversation.findById(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Not found.' });
  // Deliberately stricter than isParticipant() above: admin can VIEW a
  // conversation for moderation, but must never be able to SEND as if they
  // were the customer or the stylist — that would let an admin token
  // impersonate a real participant.
  const isRealParticipant = (actor && actor.type === 'customer' && conv.customerId === actor.id)
    || (actor && actor.type === 'stylist' && conv.stylistId === actor.id);
  if (!isRealParticipant) return res.status(403).json({ error: 'Not authorized.' });
  const { text, photo } = req.body;
  if (!text && !photo) return res.status(400).json({ error: 'Message needs text or a photo.' });
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
  const conv = await Conversation.findById(req.params.id);
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
