const mongoose = require('mongoose');

// A deliberately SEPARATE ledger from Activity.js — the spec is explicit
// that financial events must not be mixed into the general Activity Ledger.
// This is idempotency's home too: providerEventId lets a webhook retry be
// recognized and ignored rather than double-processed.
const PaymentEventSchema = new mongoose.Schema({
  paymentId: { type: String, required: true },
  type: {
    type: String,
    required: true,
    enum: [
      'PAYMENT_INITIATED', 'PAYMENT_PENDING', 'PAYMENT_SUCCESSFUL', 'PAYMENT_FAILED',
      'PAYMENT_CANCELLED', 'REFUND_INITIATED', 'REFUND_SUCCESSFUL', 'PARTIAL_REFUND',
    ],
  },
  providerEventId: { type: String, default: null },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Number, default: () => Date.now() },
});

PaymentEventSchema.index({ paymentId: 1, createdAt: 1 });
// A given provider event must only ever be recorded once — the real
// mechanism that makes webhook retries safe.
PaymentEventSchema.index({ providerEventId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.models.PaymentEvent || mongoose.model('PaymentEvent', PaymentEventSchema);
