const mongoose = require('mongoose');

// One record per person who joined Sheeba through someone's code.
//   JOINED → CHECKING (their first job is completed) → VALIDATED (automatically
//   after 7 quiet days) — or UNDER_REVIEW (a warning sign; the admin decides)
//   → VALIDATED or VOID. Validated rewards become coupons once Sheeba takes
//   payments. (EARNED/PAID are kept only for records made before this.)
// One reward per referred account, ever (unique index below).
const InviteRewardSchema = new mongoose.Schema({
  referrerType: { type: String, enum: ['stylist', 'customer'], required: true },
  referrerId: { type: String, required: true },
  referredType: { type: String, enum: ['stylist', 'customer'], required: true },
  referredId: { type: String, required: true },
  status: { type: String, enum: ['JOINED', 'CHECKING', 'UNDER_REVIEW', 'VALIDATED', 'VOID', 'EARNED', 'PAID'], default: 'JOINED' },
  flags: { type: [String], default: [] }, // warning signs found (see lib/invites.js)
  validatedAt: { type: Number, default: null },
  validatedBy: { type: String, default: null }, // an admin's id, or 'auto'
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
