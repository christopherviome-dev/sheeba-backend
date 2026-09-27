const express = require('express');
const AdminAction = require('../models/AdminAction');
const Stylist = require('../models/Stylist');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { normalizeGhanaCard, normalizeIdNumber, compareNames } = require('../lib/identity');
const { getCountry, countryOf } = require('../lib/countries');
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
const { validateDue } = require('../lib/invites');
const { setSetting } = require('../lib/settings');
const ServiceType = require('../models/ServiceType');

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
        country: getCountry(countryOf(s)).name,
        idType: s.idType || (s.ghanaCardNum ? 'GHANA_CARD' : null),
        idLabel: ((getCountry(countryOf(s)).idDocuments.find(([k]) => k === (s.idType || (s.ghanaCardNum ? 'GHANA_CARD' : null))) || [null, 'ID document'])[1]),
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
  await validateDue();
  // Default view: the ones that need a human decision.
  const VIEWS = { UNDER_REVIEW: ['UNDER_REVIEW'], CHECKING: ['CHECKING', 'EARNED'], VALIDATED: ['VALIDATED', 'PAID'], VOID: ['VOID'], JOINED: ['JOINED'] };
  const view = VIEWS[req.query.status] ? req.query.status : 'UNDER_REVIEW';
  const rewards = await InviteReward.find({ status: { $in: VIEWS[view] } }).sort({ earnedAt: 1, createdAt: 1 });
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
    groups[key].rewards.push({ _id: r._id, status: r.status, amountMinor: r.amountMinor, currency: r.currency, flag: r.flag, flags: r.flags && r.flags.length ? r.flags : (r.flag ? [r.flag] : []),
      referredName: referred ? referred.name : 'Account no longer exists', referredPhone: referred ? referred.phone : null, joinedAs: r.referredType,
      joinedAt: r.createdAt, earnedAt: r.earnedAt, paidAt: r.paidAt, paymentNote: r.paymentNote, voidReason: r.voidReason, job });
  }
  const count = async (...st) => InviteReward.countDocuments({ status: { $in: st } });
  res.json({ view, summary: { joined: await count('JOINED'), checking: await count('CHECKING', 'EARNED'), underReview: await count('UNDER_REVIEW'), validated: await count('VALIDATED', 'PAID'), voided: await count('VOID') }, groups: Object.values(groups) });
});

// Confirm a reward the admin has checked (from "under review" or "checking").
router.post('/invite-rewards/:id/validate', requireAuth, requireAdmin, async (req, res) => {
  let r = null;
  try { r = await InviteReward.findById(req.params.id); } catch (e) { /* bad id */ }
  if (!r) return res.status(404).json({ error: 'Reward not found.' });
  if (!['UNDER_REVIEW', 'CHECKING', 'EARNED'].includes(r.status)) return res.status(400).json({ error: 'Only rewards being checked or under review can be confirmed.' });
  r.status = 'VALIDATED'; r.validatedAt = Date.now(); r.validatedBy = req.stylistId;
  await r.save();
  try { await AdminAction.create({ adminId: req.stylistId, action: 'INVITE_REWARD_VALIDATED', targetType: 'invite-reward', targetId: r._id.toString() }); } catch (e) { /* non-fatal */ }
  res.json({ ok: true });
});

// Void a reward that isn't genuine (a reason is required and kept).
router.post('/invite-rewards/:id/void', requireAuth, requireAdmin, async (req, res) => {
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 5) return res.status(400).json({ error: 'Give a clear reason.' });
  let r = null;
  try { r = await InviteReward.findById(req.params.id); } catch (e) { /* bad id */ }
  if (!r) return res.status(404).json({ error: 'Reward not found.' });
  if (r.status === 'PAID') return res.status(400).json({ error: 'This reward was already paid out.' });
  if (r.status === 'VOID') return res.status(400).json({ error: 'Already voided.' });
  r.status = 'VOID'; r.voidReason = reason.slice(0, 300);
  await r.save();
  try { await AdminAction.create({ adminId: req.stylistId, action: 'INVITE_REWARD_VOIDED', targetType: 'invite-reward', targetId: r._id.toString(), reason }); } catch (e) { /* non-fatal */ }
  res.json({ ok: true });
});

// ---------- Proposed services ----------
router.get('/service-proposals', requireAuth, requireAdmin, async (req, res) => {
  const pending = await ServiceType.find({ status: 'PENDING' });
  const out = [];
  for (const p of pending) {
    const shops = await Stylist.find({ 'pendingServices.proposalId': p._id.toString() }, 'name salonName');
    out.push({ _id: p._id, name: p.name, key: p.key, createdAt: p.createdAt, shops: shops.map((x) => x.salonName || x.name) });
  }
  res.json(out);
});

router.post('/service-proposals/:id/:decision', requireAuth, requireAdmin, async (req, res) => {
  const { decision } = req.params;
  if (!['approve', 'reject'].includes(decision)) return res.status(404).json({ error: 'Not found.' });
  let p = null;
  try { p = await ServiceType.findById(req.params.id); } catch (e) { /* bad id */ }
  if (!p || p.status !== 'PENDING') return res.status(404).json({ error: 'No such proposal waiting.' });
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 200) : '';
  if (decision === 'reject' && reason.length < 5) return res.status(400).json({ error: 'Give a short reason for the professional.' });
  p.status = decision === 'approve' ? 'ACTIVE' : 'REJECTED';
  p.decidedAt = Date.now(); p.decidedBy = req.stylistId; if (decision === 'reject') p.rejectReason = reason;
  await p.save();
  // Every shop waiting on it: approved → it becomes one of their services; either way it stops being pending.
  const shops = await Stylist.find({ 'pendingServices.proposalId': p._id.toString() });
  const { servicesOf } = require('../lib/catalog');
  for (const st of shops) {
    st.pendingServices = (st.pendingServices || []).filter((x) => x.proposalId !== p._id.toString());
    if (decision === 'approve') st.services = [...new Set([...servicesOf(st), p.key])];
    await st.save();
    await notify({ recipientId: st._id.toString(), recipientType: 'stylist', type: decision === 'approve' ? 'SERVICE_APPROVED' : 'SERVICE_REJECTED',
      title: decision === 'approve' ? `"${p.name}" is now a Sheeba service` : `"${p.name}" wasn't added as a service`, message: decision === 'approve' ? 'Customers can now find you for it.' : reason, entityType: 'shop', entityId: st._id.toString(), priority: 'normal' });
  }
  try { await AdminAction.create({ adminId: req.stylistId, action: decision === 'approve' ? 'SERVICE_APPROVED' : 'SERVICE_REJECTED', targetType: 'service', targetId: p._id.toString(), reason: decision === 'approve' ? p.name : `${p.name}: ${reason}` }); } catch (e) { /* non-fatal */ }
  res.json({ ok: true, status: p.status });
});

// ---------- Admin switches ----------
const SWITCHES = { ageCheck: 'boolean' };
router.put('/settings/:key', requireAuth, requireAdmin, async (req, res) => {
  const { key } = req.params;
  if (!SWITCHES[key]) return res.status(404).json({ error: 'Unknown setting.' });
  if (typeof req.body.value !== 'boolean') return res.status(400).json({ error: 'Choose on or off.' });
  await setSetting(key, req.body.value, req.stylistId);
  try { await AdminAction.create({ adminId: req.stylistId, action: 'SETTING_CHANGED', targetType: 'setting', targetId: key, reason: `${key} ${req.body.value ? 'on' : 'off'}` }); } catch (e) { /* non-fatal */ }
  res.json({ ok: true, key, value: req.body.value });
});

module.exports = router;
