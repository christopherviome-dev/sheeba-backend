const express = require('express');
const AdminAction = require('../models/AdminAction');
const Stylist = require('../models/Stylist');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { normalizeGhanaCard, normalizeIdNumber, compareNames } = require('../lib/identity');
const { COUNTRIES, countryOf } = require('../lib/countries');
// One key per real document, whatever its type, for duplicate detection.
const docKey = (s) => {
  if (s.ghanaCardNum) return 'GHANA_CARD:' + (normalizeGhanaCard(s.ghanaCardNum) || String(s.ghanaCardNum).toUpperCase().trim());
  if (s.idNumber) return (s.idType || 'ID') + ':' + (normalizeIdNumber(s.idNumber) || String(s.idNumber).toUpperCase());
  return null;
};
const bcrypt = require('bcryptjs');
const Customer = require('../models/Customer');
const PasswordResetRequest = require('../models/PasswordResetRequest');
const { generateTempPassword } = require('../lib/passwords');
const InviteReward = require('../models/InviteReward');
const Request = require('../models/Request');
const { notify } = require('./notifications');

const router = express.Router();

router.get('/audit', requireAuth, requireAdmin, async (req, res) => {
  const list = await AdminAction.find({}).sort({ createdAt: -1 }).limit(200);
  res.json(list);
});

// Admin-only ID verification queue. Each submission comes with two
// automatic signals to help the human reviewer, never to replace them:
//  - nameCheck: typed legal name vs the name the account registered with
//  - duplicateAccounts: other accounts that submitted the same card number
router.get('/verifications', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pending = await Stylist.find({ pendingReview: true }).sort({ verificationSubmittedAt: 1 });
    // At today's scale, comparing in memory is fine and also catches card
    // numbers saved before normalization existed. At large scale this
    // should become an indexed, normalized field.
    const withCards = (await Stylist.find({}, '_id name salonName ghanaCardNum idType idNumber verified')).filter((s) => docKey(s));
    const byCard = new Map();
    for (const s of withCards) {
      const key = docKey(s);
      if (!byCard.has(key)) byCard.set(key, []);
      byCard.get(key).push(s);
    }
    res.json(pending.map((s) => {
      const key = docKey(s);
      const others = key
        ? (byCard.get(key) || []).filter((o) => o._id.toString() !== s._id.toString())
        : [];
      const missing = [];
      if (!s.legalFullName) missing.push('legal name');
      if (!s.ghanaCardNum && !s.idNumber) missing.push('document number');
      if (!s.verifyPhoto) missing.push('document photo');
      return {
        _id: s._id,
        name: s.name,
        salonName: s.salonName,
        phone: s.phone,
        legalFullName: s.legalFullName,
        country: COUNTRIES[countryOf(s)].name,
        idType: s.idType || (s.ghanaCardNum ? 'GHANA_CARD' : null),
        idLabel: ((COUNTRIES[countryOf(s)].idDocuments.find(([k]) => k === (s.idType || (s.ghanaCardNum ? 'GHANA_CARD' : null))) || [null, 'ID document'])[1]),
        ghanaCardNum: s.ghanaCardNum || s.idNumber, // the document number, whatever its type (name kept for the app)
        cardFormatValid: s.ghanaCardNum ? !!normalizeGhanaCard(s.ghanaCardNum) : !!normalizeIdNumber(s.idNumber),
        verifyPhoto: s.verifyPhoto,
        submittedAt: s.verificationSubmittedAt,
        nameCheck: s.legalFullName ? compareNames(s.name, s.legalFullName) : 'UNKNOWN',
        duplicateAccounts: others.map((o) => ({ _id: o._id, name: o.name, salonName: o.salonName, verified: o.verified })),
        missing,
      };
    }));
  } catch (e) {
    res.status(500).json({ error: 'Could not load the verification queue.' });
  }
});

// ---------- Password help ----------
// Open "Forgot password?" requests, with the account's own name and the
// phone number STORED ON THE ACCOUNT. The admin calls that number (never a
// number supplied some other way) to confirm identity before issuing.
router.get('/password-resets', requireAuth, requireAdmin, async (req, res) => {
  const open = await PasswordResetRequest.find({ status: 'OPEN' }).sort({ createdAt: 1 });
  const items = await Promise.all(open.map(async (r) => {
    const Model = r.accountType === 'customer' ? Customer : Stylist;
    let acc = null;
    try { acc = await Model.findById(r.accountId, 'name salonName phone'); } catch (e) { /* stale id */ }
    return { _id: r._id, accountType: r.accountType, createdAt: r.createdAt,
      name: acc ? acc.name : null, salonName: acc ? acc.salonName : null, phone: acc ? acc.phone : null, accountFound: !!acc };
  }));
  res.json(items);
});

async function loadOpenRequest(id) {
  let r = null;
  try { r = await PasswordResetRequest.findById(id); } catch (e) { return null; }
  return r && r.status === 'OPEN' ? r : null;
}

// Issue a temporary password. It is returned ONCE, in this response, for the
// admin to read out over the phone; only its scrambled form is stored, and
// the audit log records that a reset happened, never the password itself.
router.post('/password-resets/:id/issue', requireAuth, requireAdmin, async (req, res) => {
  const r = await loadOpenRequest(req.params.id);
  if (!r) return res.status(404).json({ error: 'This request is no longer open.' });
  const Model = r.accountType === 'customer' ? Customer : Stylist;
  let acc = null;
  try { acc = await Model.findById(r.accountId); } catch (e) { /* stale id */ }
  if (!acc) return res.status(404).json({ error: 'That account no longer exists.' });
  const tempPassword = generateTempPassword();
  acc.passwordHash = await bcrypt.hash(tempPassword, 10);
  acc.mustChangePassword = true;
  await acc.save();
  r.status = 'RESOLVED'; r.resolvedAt = Date.now(); r.resolvedBy = req.stylistId;
  await r.save();
  try { await AdminAction.create({ adminId: req.stylistId, action: 'PASSWORD_RESET_ISSUED', targetType: r.accountType, targetId: r.accountId }); } catch (e) { /* non-fatal */ }
  res.json({ tempPassword, name: acc.salonName || acc.name, phone: acc.phone });
});

router.post('/password-resets/:id/dismiss', requireAuth, requireAdmin, async (req, res) => {
  const r = await loadOpenRequest(req.params.id);
  if (!r) return res.status(404).json({ error: 'This request is no longer open.' });
  r.status = 'DISMISSED'; r.resolvedAt = Date.now(); r.resolvedBy = req.stylistId;
  await r.save();
  try { await AdminAction.create({ adminId: req.stylistId, action: 'PASSWORD_RESET_DISMISSED', targetType: 'password-reset', targetId: r._id.toString() }); } catch (e) { /* non-fatal */ }
  res.json({ ok: true });
});

// ---------- Invite rewards ----------
// Earned-but-unpaid rewards, grouped by the person to pay. Each shows the job
// that qualified it, so the admin can check it's genuine before paying by hand.
router.get('/invite-rewards', requireAuth, requireAdmin, async (req, res) => {
  const status = ['EARNED', 'PAID', 'VOID', 'JOINED'].includes(req.query.status) ? req.query.status : 'EARNED';
  const rewards = await InviteReward.find({ status }).sort({ earnedAt: 1, createdAt: 1 });
  const load = async (type, id, fields) => {
    const M = type === 'customer' ? Customer : Stylist;
    try { return await M.findById(id, fields); } catch (e) { return null; }
  };
  const groups = {};
  for (const r of rewards) {
    const key = r.referrerType + ':' + r.referrerId;
    if (!groups[key]) {
      const who = await load(r.referrerType, r.referrerId, 'name salonName phone code');
      groups[key] = { referrerType: r.referrerType, referrerId: r.referrerId,
        name: who ? (who.salonName || who.name) : 'Account no longer exists', phone: who ? who.phone : null, code: who ? who.code : null,
        totalMinor: 0, currency: r.currency, rewards: [] };
    }
    const referred = await load(r.referredType, r.referredId, 'name phone');
    let job = null;
    if (r.earnedRequestId) {
      let q = null;
      try { q = await Request.findById(r.earnedRequestId); } catch (e) { /* stale */ }
      if (q) {
        const pro = await load('stylist', q.stylistId, 'name salonName');
        job = { service: q.serviceNameSnapshot || 'Service', price: q.priceSnapshot, professional: pro ? (pro.salonName || pro.name) : null, when: q.preferredAt || q.date || null, completedAt: r.earnedAt };
      }
    }
    groups[key].totalMinor += r.amountMinor || 0;
    groups[key].rewards.push({ _id: r._id, status: r.status, amountMinor: r.amountMinor, currency: r.currency, flag: r.flag,
      referredName: referred ? referred.name : 'Account no longer exists', referredPhone: referred ? referred.phone : null, joinedAs: r.referredType,
      joinedAt: r.createdAt, earnedAt: r.earnedAt, paidAt: r.paidAt, paymentNote: r.paymentNote, voidReason: r.voidReason, job });
  }
  const count = async (st) => InviteReward.countDocuments({ status: st });
  res.json({ summary: { joined: await count('JOINED'), earned: await count('EARNED'), paid: await count('PAID'), voided: await count('VOID') }, groups: Object.values(groups) });
});

// Mark rewards as paid after sending the money by hand (e.g. Mobile Money).
// All must belong to one person and still be unpaid; the note is kept.
router.post('/invite-rewards/pay', requireAuth, requireAdmin, async (req, res) => {
  const ids = Array.isArray(req.body.rewardIds) ? req.body.rewardIds.map(String) : [];
  const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 200) : '';
  if (ids.length === 0) return res.status(400).json({ error: 'Choose at least one reward.' });
  let rewards = [];
  try { rewards = await InviteReward.find({ _id: { $in: ids } }); } catch (e) { return res.status(400).json({ error: 'Invalid reward.' }); }
  if (rewards.length !== ids.length) return res.status(404).json({ error: 'Some of those rewards no longer exist.' });
  if (rewards.some((r) => r.status !== 'EARNED')) return res.status(400).json({ error: 'Only earned, unpaid rewards can be marked paid.' });
  const owner = rewards[0].referrerType + ':' + rewards[0].referrerId;
  if (rewards.some((r) => r.referrerType + ':' + r.referrerId !== owner)) return res.status(400).json({ error: 'Pay one person at a time.' });
  const now = Date.now();
  const result = await InviteReward.updateMany({ _id: { $in: ids }, status: 'EARNED' }, { $set: { status: 'PAID', paidAt: now, paidBy: req.stylistId, paymentNote: note || null } });
  const total = rewards.reduce((t, r) => t + (r.amountMinor || 0), 0);
  try { await AdminAction.create({ adminId: req.stylistId, action: 'INVITE_REWARDS_PAID', targetType: rewards[0].referrerType, targetId: rewards[0].referrerId, reason: `${ids.length} reward(s), ${total} ${rewards[0].currency || ''} minor units${note ? ' · ' + note : ''}` }); } catch (e) { /* non-fatal */ }
  await notify({ recipientId: rewards[0].referrerId, recipientType: rewards[0].referrerType, type: 'INVITE_REWARD_PAID', title: 'Your invite reward was sent', message: note ? `Reference: ${note}` : 'Thank you for helping Sheeba grow.', entityType: null, entityId: null, priority: 'important' });
  res.json({ ok: true, paid: result.modifiedCount != null ? result.modifiedCount : ids.length });
});

// Void a reward that isn't genuine (a reason is required and kept).
router.post('/invite-rewards/:id/void', requireAuth, requireAdmin, async (req, res) => {
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 5) return res.status(400).json({ error: 'Give a clear reason.' });
  let r = null;
  try { r = await InviteReward.findById(req.params.id); } catch (e) { /* bad id */ }
  if (!r) return res.status(404).json({ error: 'Reward not found.' });
  if (r.status === 'PAID') return res.status(400).json({ error: 'This reward was already paid.' });
  if (r.status === 'VOID') return res.status(400).json({ error: 'Already voided.' });
  r.status = 'VOID'; r.voidReason = reason.slice(0, 300);
  await r.save();
  try { await AdminAction.create({ adminId: req.stylistId, action: 'INVITE_REWARD_VOIDED', targetType: 'invite-reward', targetId: r._id.toString(), reason }); } catch (e) { /* non-fatal */ }
  res.json({ ok: true });
});

module.exports = router;
