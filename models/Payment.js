const mongoose = require('mongoose');

// Money is always stored as an integer in minor units (e.g. pesewas for
// GHS, cents for USD) — never a float. GHS 800.00 is stored as 80000.
const PaymentSchema = new mongoose.Schema({
  customerId: { type: String, default: null },
  stylistId: { type: String, required: true },
  requestId: { type: String, default: null },
  styleId: { type: String, default: null },
  purpose: { type: String, enum: ['DEPOSIT', 'FULL_PAYMENT'], required: true },
  amountMinor: { type: Number, required: true },
  currency: { type: String, required: true },
  provider: { type: String, default: 'paystack' },
  providerReference: { type: String, default: null }, // the provider's own transaction reference
  internalReference: { type: String, required: true, unique: true }, // our own idempotency key
  status: {
    type: String,
    enum: ['INITIATED', 'PENDING', 'SUCCESSFUL', 'FAILED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED'],
    default: 'INITIATED',
  },
  paymentMethod: { type: String, default: null },
  paidAt: { type: Number, default: null },
  refundedAt: { type: Number, default: null },
  refundAmountMinor: { type: Number, default: 0 },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Number, default: () => Date.now() },
  updatedAt: { type: Number, default: () => Date.now() },
});

PaymentSchema.index({ stylistId: 1, createdAt: -1 });
PaymentSchema.index({ customerId: 1, createdAt: -1 });

module.exports = mongoose.models.Payment || mongoose.model('Payment', PaymentSchema);
