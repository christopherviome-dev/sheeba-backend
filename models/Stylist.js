const mongoose = require('mongoose');

const StyleSchema = new mongoose.Schema({
  id: String,
  name: String,
  price: Number,
  duration: String,
  desc: String,
  photo: String, // base64 data URL — fine at this scale, move to cloud storage later if it grows
  colorTag: String,
  active: { type: Boolean, default: true },
  // Payment is opt-in per service, per the trust-first philosophy — every
  // existing style implicitly has no payment requirement until a
  // professional explicitly turns one on.
  paymentRequirement: { type: String, enum: ['NO_PAYMENT_REQUIRED', 'DEPOSIT_REQUIRED', 'FULL_PAYMENT_REQUIRED'], default: 'NO_PAYMENT_REQUIRED' },
  depositAmount: { type: Number, default: null }, // minor units, only meaningful when DEPOSIT_REQUIRED
  likes: { type: [String], default: [] }, // clientIds
}, { _id: false });

const StylistSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  name: String,
  salonName: String,
  category: String,
  area: String,
  bio: String,
  coverPhoto: String,
  profilePhoto: String,
  brandColor: String,
  verifyPhoto: String,
  ghanaCardNum: String,
  pendingReview: { type: Boolean, default: false },
  verified: { type: Boolean, default: false },
  // Ghana Card verification, Layer 1. The legal name is private: only the
  // account owner and admins ever see it (stripped in publicStylist).
  legalFullName: { type: String, default: null },
  verificationSubmittedAt: { type: Number, default: null },
  verificationReviewedAt: { type: Number, default: null },
  verificationRejectedReason: { type: String, default: null },
  color: String,
  styles: { type: [StyleSchema], default: [] },
  followers: { type: [String], default: [] }, // clientIds
  lastActiveAt: { type: Number, default: () => Date.now() },
  isAdmin: { type: Boolean, default: false },
  status: { type: String, enum: ['UNDER_REVIEW', 'APPROVED'], default: 'UNDER_REVIEW' },
  // Deliberately separate from `status` above — that's shop-listing review,
  // this is account-level governance. A shop can be APPROVED while the
  // account is later RESTRICTED for a violation; conflating the two would
  // make it impossible to represent that real situation.
  accountStatus: { type: String, enum: ['ACTIVE', 'RESTRICTED', 'SUSPENDED', 'BANNED', 'DEACTIVATED'], default: 'ACTIVE' },
  restrictionReason: { type: String, default: null },
  restrictedAt: { type: Number, default: null },
  restrictedBy: { type: String, default: null }, // admin's stylistId
  restoredAt: { type: Number, default: null },
  // Staff/apprentice access: other REAL Sheeba accounts (their own, not a
  // fake invite to someone without one) authorized to see and respond to
  // THIS shop's requests on the owner's behalf. Deliberately does not grant
  // access to edit this shop's branding, services, or account settings —
  // scoped narrowly to the operational side, per the actual stated need.
  staffAccess: [{
    stylistId: { type: String, required: true },
    addedAt: { type: Number, default: () => Date.now() },
  }],
  groupPoints: { type: Number, default: 0 },
  starStatus: { type: Boolean, default: false },
  availability: {
    type: String,
    enum: ['AVAILABLE', 'TAKING_REQUESTS', 'UNAVAILABLE', 'AWAY'],
    default: 'AVAILABLE',
  },
  // A shop's authoritative local currency — never inferred, never hidden.
  // Existing shops (created before this field existed) default to GHS,
  // matching every price already entered on the platform.
  currency: { type: String, default: 'GHS' },
  // Real coordinates, set only when the professional explicitly opts in via
  // their own device's GPS — never required, never inferred from IP or
  // anything else. Absent for every existing shop until they choose to add it.
  location: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
  },
}, { timestamps: true });

module.exports = mongoose.models.Stylist || mongoose.model('Stylist', StylistSchema);
