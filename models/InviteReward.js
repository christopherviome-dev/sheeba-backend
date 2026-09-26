const mongoose = require('mongoose');

// One record per person who joined Sheeba through someone's code.
//   JOINED → EARNED (their first job is completed) → PAID (the admin sent the
//   reward by hand and noted the reference), or VOID (admin found a problem).
// One reward per referred account, ever (unique index below).
const InviteRewardSchema = new mongoose.Schema({
  referrerType: { type: String, enum: ['stylist', 'customer'], required: true },
  referrerId: { type: String, required: true },
  referredType: { type: String, enum: ['stylist', 'customer'], required: true },
  referredId: { type: String, required: true },
  status: { type: String, enum: ['JOINED', 'EARNED', 'PAID', 'VOID'], default: 'JOINED' },
  amountMinor: { type: Number, default: null }, // money in minor units (pesewas, pence)
  currency: { type: String, default: null },
  earnedAt: { type: Number, default: null },
  earnedRequestId: { type: String, default: null },
  // Set when the person who invited is ALSO on the qualifying job (as its
  // professional or its customer): the classic pattern of faked completions.
  flag: { type: String, default: null },
  paidAt: { type: Number, default: null },
  paidBy: { type: String, default: null },
  paymentNote: { type: String, default: null }, // e.g. a Mobile Money reference
  voidReason: { type: String, default: null },
  createdAt: { type: Number, default: () => Date.now() },
});

InviteRewardSchema.index({ referredType: 1, referredId: 1 }, { unique: true });
InviteRewardSchema.index({ referrerType: 1, referrerId: 1, status: 1 });
InviteRewardSchema.index({ status: 1, earnedAt: 1 });

module.exports = mongoose.models.InviteReward || mongoose.model('InviteReward', InviteRewardSchema);
