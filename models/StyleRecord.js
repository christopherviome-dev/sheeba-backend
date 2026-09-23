const mongoose = require('mongoose');

// Created automatically the moment a real request completes — never
// manually fabricated. This is the customer's actual service history,
// distinct from a SavedStyle (customer's own aspirational reference) and
// from a professional's portfolio photo (their published work).
const StyleRecordSchema = new mongoose.Schema({
  customerId: { type: String, required: true },
  stylistId: { type: String, required: true },
  requestId: { type: String, required: true, unique: true }, // one record per completed request, never duplicated
  styleId: { type: String, default: null },
  serviceName: { type: String, default: null },
  priceMinorSnapshot: { type: Number, default: null }, // stored as-is from the request's own historical snapshot
  price: { type: Number, default: null },
  duration: { type: String, default: null },
  currency: { type: String, default: 'GHS' },
  // The actual finished result, added by the customer afterward via "Save
  // This Style" — never auto-populated from a portfolio or reference photo,
  // since neither of those is proof of what this specific service looked like.
  finishedPhoto: { type: String, default: null },
  notes: { type: String, default: null },
  completedAt: { type: Number, required: true },
  createdAt: { type: Number, default: () => Date.now() },
});

StyleRecordSchema.index({ customerId: 1, completedAt: -1 });
StyleRecordSchema.index({ stylistId: 1, customerId: 1 });

module.exports = mongoose.models.StyleRecord || mongoose.model('StyleRecord', StyleRecordSchema);
