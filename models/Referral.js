const mongoose = require('mongoose');

// A named, shareable link a professional creates — covers both "referral
// code" and "campaign" from the spec as one thing, since a campaign IS just
// a labeled referral code. Real counts are queried from Activity records
// tagged with this code, never stored as a separately-incrementable field
// that could drift out of sync with what actually happened.
const ReferralSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  stylistId: { type: String, required: true },
  label: { type: String, required: true }, // e.g. "WhatsApp September"
  channel: { type: String, enum: ['WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'BUSINESS_CARD', 'QR_POSTER', 'DIRECT_LINK', 'OTHER'], default: 'OTHER' },
  active: { type: Boolean, default: true },
  createdAt: { type: Number, default: () => Date.now() },
});

ReferralSchema.index({ stylistId: 1 });

module.exports = mongoose.models.Referral || mongoose.model('Referral', ReferralSchema);
