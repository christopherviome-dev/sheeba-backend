const jwt = require('jsonwebtoken');
const InviteReward = require('../models/InviteReward');
const { normalizeCode } = require('./codes');

// The reward for each completed invite, in minor units, by currency.
// GH₵1 = 100 pesewas, set by Christopher. A currency without its own amount
// yet falls back to the Ghana reward, paid in cedis.
const REWARD_MINOR = { GHS: 100 };
function rewardFor(currency) {
  if (currency && REWARD_MINOR[currency] != null) return { amountMinor: REWARD_MINOR[currency], currency };
  return { amountMinor: REWARD_MINOR.GHS, currency: 'GHS' };
}

// Find whichever account owns a code: professional or customer.
async function findByCode(code, Stylist, Customer) {
  const c = normalizeCode(code);
  if (!c) return null;
  const st = await Stylist.findOne({ code: c });
  if (st) return { type: 'stylist', doc: st };
  const cu = await Customer.findOne({ code: c });
  if (cu) return { type: 'customer', doc: cu };
  return null;
}

// Called right after a new account is created. Never blocks signup: an
// unknown or invalid code simply records nothing.
async function recordInvite({ inviteCode, newType, newDoc, Stylist, Customer, notify }) {
  if (!inviteCode) return null;
  const referrer = await findByCode(inviteCode, Stylist, Customer);
  if (!referrer) return null;
  const refId = referrer.doc._id.toString();
  const newId = newDoc._id.toString();
  // No self-invites: the same account, or the same phone number (one person
  // making a customer account with their own shop's code), earns nothing.
  if (refId === newId) return null;
  if (String(referrer.doc.phone || '').replace(/\D/g, '').slice(-9) === String(newDoc.phone || '').replace(/\D/g, '').slice(-9)) return null;
  try {
    const inv = await InviteReward.create({ referrerType: referrer.type, referrerId: refId, referredType: newType, referredId: newId });
    newDoc.invitedByType = referrer.type;
    newDoc.invitedById = refId;
    await newDoc.save();
    if (notify) await notify({ recipientId: refId, recipientType: referrer.type, type: 'INVITE_JOINED', title: 'Someone joined Sheeba with your code', message: 'You earn your reward when they complete their first job.', entityType: null, entityId: null, priority: 'normal' });
    return inv;
  } catch (e) {
    return null; // duplicate (already invited) or a hiccup: signup still succeeds
  }
}

// Called when a booking is marked completed. The customer and the
// professional on that job may each have been invited; each earns their
// referrer a reward on their FIRST completed job only.
async function markInviteEarned(request, { Stylist, Customer, notify }) {
  const results = [];
  const people = [];
  if (request.clientId) people.push({ referredType: 'customer', referredId: String(request.clientId) });
  if (request.stylistId) people.push({ referredType: 'stylist', referredId: String(request.stylistId) });
  for (const p of people) {
    const pending = await InviteReward.findOne({ ...p, status: 'JOINED' });
    if (!pending) continue;
    const Model = pending.referrerType === 'customer' ? Customer : Stylist;
    const referrer = await Model.findById(pending.referrerId);
    const reward = rewardFor(referrer && referrer.currency);
    const involved = pending.referrerId === String(request.stylistId) || pending.referrerId === String(request.clientId);
    // Atomic: only moves JOINED → EARNED once, even if two completions race.
    const earned = await InviteReward.findOneAndUpdate(
      { _id: pending._id, status: 'JOINED' },
      { $set: { status: 'EARNED', earnedAt: Date.now(), earnedRequestId: String(request._id), ...reward, flag: involved ? 'REFERRER_INVOLVED' : null } },
      { new: true }
    );
    if (!earned) continue;
    results.push(earned);
    if (notify) await notify({ recipientId: pending.referrerId, recipientType: pending.referrerType, type: 'INVITE_REWARD_EARNED', title: 'You earned an invite reward', message: 'Someone you invited completed their first job on Sheeba.', entityType: null, entityId: null, priority: 'important' });
  }
  return results;
}

// Works out who is calling from their login, professional or customer, for
// routes open to both.
function accountFromRequest(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET);
    return p.role === 'customer' ? { type: 'customer', id: p.id } : { type: 'stylist', id: p.id, isAdmin: !!p.isAdmin };
  } catch (e) { return null; }
}

module.exports = { REWARD_MINOR, rewardFor, findByCode, recordInvite, markInviteEarned, accountFromRequest };
