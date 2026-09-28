const jwt = require('jsonwebtoken');
const InviteReward = require('../models/InviteReward');
const Request = require('../models/Request');
const { normalizeCode, codeQuery } = require('./codes');

// The reward for each completed invite, in minor units, by currency.
// GH₵1 = 100 pesewas, set by Christopher. A currency without its own amount
// yet falls back to the Ghana reward, paid in cedis.
const REWARD_MINOR = { GHS: 100 };
// Every invite is worth the equivalent of GH₵1, in every country (decided by
// Christopher). Recorded in cedis, the currency Sheeba funds rewards in, so the
// total owed is one clean figure; shown in each person's own currency at
// today's rate (lib/fx.js). No cash is paid while Sheeba takes no payments:
// rewards become coupons for a free or discounted service once it does.
function rewardFor() {
  return { amountMinor: REWARD_MINOR.GHS, currency: 'GHS' };
}

// Find whichever account owns a code: professional or customer.
async function findByCode(code, Stylist, Customer) {
  const c = normalizeCode(code);
  if (!c) return null;
  const st = await Stylist.findOne(codeQuery(c));
  if (st) return { type: 'stylist', doc: st };
  const cu = await Customer.findOne(codeQuery(c));
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
// professional on that job may each have been invited; each moves their
// referrer's reward to CHECKING on their FIRST completed job only. Warning
// signs send it to UNDER_REVIEW instead, for the admin to decide:
//   REFERRER_INVOLVED  the inviter was on the job (as professional or customer)
//   QUICK_FIRST_JOB    completed within 24 hours of the new account being created
//   SAME_PROFESSIONAL  this inviter's referrals keep completing with the same
//                      professional (3 or more): the "cooked up together" pattern
const DAY = 24 * 3600 * 1000;
const COUNTED = ['CHECKING', 'UNDER_REVIEW', 'VALIDATED', 'EARNED', 'PAID'];

async function markInviteEarned(request, { Stylist, Customer, notify }) {
  const results = [];
  const people = [];
  if (request.clientId) people.push({ referredType: 'customer', referredId: String(request.clientId) });
  if (request.stylistId) people.push({ referredType: 'stylist', referredId: String(request.stylistId) });
  for (const p of people) {
    const pending = await InviteReward.findOne({ ...p, status: 'JOINED' });
    if (!pending) continue;
    const flags = [];
    if (pending.referrerId === String(request.stylistId) || pending.referrerId === String(request.clientId)) flags.push('REFERRER_INVOLVED');
    const NewModel = p.referredType === 'customer' ? Customer : Stylist;
    let newAccount = null;
    try { newAccount = await NewModel.findById(p.referredId, 'createdAt'); } catch (e) { /* stale */ }
    if (newAccount && newAccount.createdAt && Date.now() - new Date(newAccount.createdAt).getTime() < DAY) flags.push('QUICK_FIRST_JOB');
    const others = await InviteReward.find({ referrerType: pending.referrerType, referrerId: pending.referrerId, status: { $in: COUNTED } });
    const otherJobs = others.map((o) => o.earnedRequestId).filter(Boolean);
    if (otherJobs.length >= 2) {
      const jobs = await Request.find({ _id: { $in: otherJobs } });
      const samePro = jobs.filter((j) => String(j.stylistId) === String(request.stylistId)).length;
      if (samePro >= 2) flags.push('SAME_PROFESSIONAL');
    }
    const reward = rewardFor();
    // Atomic: only moves JOINED onwards once, even if two completions race.
    const earned = await InviteReward.findOneAndUpdate(
      { _id: pending._id, status: 'JOINED' },
      { $set: { status: flags.length ? 'UNDER_REVIEW' : 'CHECKING', earnedAt: Date.now(), earnedRequestId: String(request._id), ...reward, flags, flag: flags[0] || null } },
      { new: true }
    );
    if (!earned) continue;
    results.push(earned);
    if (notify) await notify({ recipientId: pending.referrerId, recipientType: pending.referrerType, type: 'INVITE_REWARD_EARNED', title: 'Someone you invited completed their first job', message: 'Your reward is being checked and will count once it\u2019s confirmed.', entityType: null, entityId: null, priority: 'normal' });
  }
  return results;
}

// Rewards still "checking" after 7 days with no warning signs are confirmed
// automatically. Called whenever rewards are looked at, so no timer is needed.
async function validateDue() {
  const cutoff = Date.now() - 7 * DAY;
  return InviteReward.updateMany(
    { status: { $in: ['CHECKING', 'EARNED'] }, earnedAt: { $lte: cutoff }, flag: null },
    { $set: { status: 'VALIDATED', validatedAt: Date.now(), validatedBy: 'auto' } }
  );
}

// Works out who is calling from their login, professional or customer, for
// routes open to both.
function accountFromRequest(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET);
    return p.role === 'customer' ? { type: 'customer', id: p.id } : { type: 'stylist', id: p.id }; // admin rights are never taken from a token
  } catch (e) { return null; }
}

module.exports = { REWARD_MINOR, rewardFor, findByCode, recordInvite, markInviteEarned, validateDue, accountFromRequest };
