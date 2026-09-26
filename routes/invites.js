const express = require('express');
const Stylist = require('../models/Stylist');
const Customer = require('../models/Customer');
const InviteReward = require('../models/InviteReward');
const { ensureCode } = require('../lib/codes');
const { accountFromRequest, rewardFor } = require('../lib/invites');

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
  const earned = invites.filter((i) => i.status === 'EARNED' || i.status === 'PAID');
  const paid = invites.filter((i) => i.status === 'PAID');
  res.json({
    code,
    reward: rewardFor(me.currency), // what each completed invite is worth to this account
    counts: {
      joined: invites.filter((i) => i.status !== 'VOID').length,
      earned: earned.length,
      paid: paid.length,
    },
    totals: { earnedMinor: sum(earned), paidMinor: sum(paid), owedMinor: sum(earned) - sum(paid) },
    invites: invites.map((i) => ({
      status: i.status, name: names[i._id], joinedAs: i.referredType,
      createdAt: i.createdAt, earnedAt: i.earnedAt, paidAt: i.paidAt,
      amountMinor: i.amountMinor, currency: i.currency,
    })),
  });
});

module.exports = router;
