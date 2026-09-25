const express = require('express');
const AdminAction = require('../models/AdminAction');
const Stylist = require('../models/Stylist');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { normalizeGhanaCard, compareNames } = require('../lib/identity');
const bcrypt = require('bcryptjs');
const Customer = require('../models/Customer');
const PasswordResetRequest = require('../models/PasswordResetRequest');
const { generateTempPassword } = require('../lib/passwords');

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
    const withCards = await Stylist.find({ ghanaCardNum: { $nin: [null, ''] } }, '_id name salonName ghanaCardNum verified');
    const cardKey = (n) => normalizeGhanaCard(n) || String(n || '').toUpperCase().trim();
    const byCard = new Map();
    for (const s of withCards) {
      const key = cardKey(s.ghanaCardNum);
      if (!byCard.has(key)) byCard.set(key, []);
      byCard.get(key).push(s);
    }
    res.json(pending.map((s) => {
      const others = s.ghanaCardNum
        ? (byCard.get(cardKey(s.ghanaCardNum)) || []).filter((o) => o._id.toString() !== s._id.toString())
        : [];
      const missing = [];
      if (!s.legalFullName) missing.push('legal name');
      if (!s.ghanaCardNum) missing.push('card number');
      if (!s.verifyPhoto) missing.push('card photo');
      return {
        _id: s._id,
        name: s.name,
        salonName: s.salonName,
        phone: s.phone,
        legalFullName: s.legalFullName,
        ghanaCardNum: s.ghanaCardNum,
        cardFormatValid: !!normalizeGhanaCard(s.ghanaCardNum),
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

module.exports = router;
