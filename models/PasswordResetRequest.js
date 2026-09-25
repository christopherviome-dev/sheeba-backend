const mongoose = require('mongoose');

// A "Forgot password?" request, waiting for an admin to confirm identity
// (by calling the phone number stored on the account) and issue a
// temporary password. Never stores any password itself.
const PasswordResetRequestSchema = new mongoose.Schema({
  accountType: { type: String, enum: ['stylist', 'customer'], required: true },
  accountId: { type: String, required: true },
  status: { type: String, enum: ['OPEN', 'RESOLVED', 'DISMISSED'], default: 'OPEN' },
  resolvedAt: { type: Number, default: null },
  resolvedBy: { type: String, default: null }, // admin's account id
  createdAt: { type: Number, default: () => Date.now() },
});

PasswordResetRequestSchema.index({ status: 1, createdAt: 1 });
PasswordResetRequestSchema.index({ accountType: 1, accountId: 1, status: 1 });

module.exports = mongoose.models.PasswordResetRequest || mongoose.model('PasswordResetRequest', PasswordResetRequestSchema);
