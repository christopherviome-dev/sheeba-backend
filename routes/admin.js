const express = require('express');
const AdminAction = require('../models/AdminAction');
const Stylist = require('../models/Stylist');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { normalizeGhanaCard, compareNames } = require('../lib/identity');

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

module.exports = router;
