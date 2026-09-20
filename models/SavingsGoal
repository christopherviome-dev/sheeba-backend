const mongoose = require('mongoose');

// IMPORTANT, STATED PLAINLY: this is a personal planning record, not a
// wallet. No money is transferred, held, or managed by Sheeba because of
// this document existing — it exists purely so a customer can track their
// own intention to save toward a future service, and so a future
// repeat-service reminder has something real to attach a suggestion to.
// Actually holding customer funds is a real regulated undertaking and is
// deliberately NOT what this model does.
const SavingsGoalSchema = new mongoose.Schema({
  customerId: { type: String, required: true },
  label: { type: String, required: true }, // e.g. "My next retwist"
  targetAmountMinor: { type: Number, required: true },
  currency: { type: String, default: 'GHS' },
  stylistId: { type: String, default: null }, // optional link to a specific shop
  styleId: { type: String, default: null },
  note: { type: String, default: null },
  createdAt: { type: Number, default: () => Date.now() },
});

SavingsGoalSchema.index({ customerId: 1, createdAt: -1 });

module.exports = mongoose.models.SavingsGoal || mongoose.model('SavingsGoal', SavingsGoalSchema);
