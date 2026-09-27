const express = require('express');
const Stylist = require('../models/Stylist');
const Customer = require('../models/Customer');
const InviteReward = require('../models/InviteReward');
const { ensureCode } = require('../lib/codes');
const { accountFromRequest, rewardFor, validateDue } = require('../lib/invites');
const { fromGHS } = require('../lib/fx');
const { getCountry, countryOf } = require('../lib/countries');
const { FOUNDING_LIMIT } = require('../lib/members');

const router = express.Router();

// My code and my invites, for professionals and customers alike.
router.get('/me', async (req, res) => {
  const who = accountFromRequest(req);
  if (!who) return res.status(401).json({ error: 'Please log in.' });
  const Model = who.type === 'customer' ? Customer : Stylist;
  let me = null;
  try { me = await Model.findById(who.id); } catch (e) { /* bad id */ }
  if (!me) return res.status(404).json({ error: 'Account not found.' });
  const code = await ensureCode(me, Stylist, Customer); // older accounts get their code here
  await validateDue();
  const invites = await InviteReward.find({ referrerType: who.type, referrerId: who.id }).sort({ createdAt: -1 });
  // Show only a first name for the people you invited: enough to recognise them.
  const names = {};
  for (const inv of invites) {
    const M = inv.referredType === 'customer' ? Customer : Stylist;
    let d = null;
    try { d = await M.findById(inv.referredId, 'name'); } catch (e) { /* stale */ }
    names[inv._id] = d && d.name ? String(d.name).trim().split(/\s+/)[0] : 'Someone';
  }
  const sum = (list) => list.reduce((t, i) => t + (i.amountMinor || 0), 0);
  const is = (...st) => invites.filter((i) => st.includes(i.status));
  const validated = is('VALIDATED', 'PAID');
  const checking = is('CHECKING', 'EARNED');
  // Shown in this person's own currency at today's rate (when a rate is known).
  const localCurrency = me.currency || getCountry(countryOf(me)).currency;
  const local = async (minor) => (localCurrency === 'GHS' ? null : fromGHS(minor, localCurrency));
  res.json({
    code,
    memberNumber: me.memberNumber || null,
    founding: !!(me.memberNumber && me.memberNumber <= FOUNDING_LIMIT),
    reward: rewardFor(), // GH₵1 equivalent per completed invite
    rewardLocal: await local(rewardFor().amountMinor),
    counts: {
      joined: invites.filter((i) => i.status !== 'VOID').length,
      checking: checking.length,
      underReview: is('UNDER_REVIEW').length,
      validated: validated.length,
    },
    totals: { validatedMinor: sum(validated), checkingMinor: sum(checking) + sum(is('UNDER_REVIEW')) },
    validatedLocal: await local(sum(validated)),
    invites: invites.map((i) => ({
      status: i.status === 'EARNED' ? 'CHECKING' : i.status === 'PAID' ? 'VALIDATED' : i.status, name: names[i._id], joinedAs: i.referredType,
      createdAt: i.createdAt, earnedAt: i.earnedAt, paidAt: i.paidAt,
      amountMinor: i.amountMinor, currency: i.currency,
    })),
  });
});

module.exports = router;
