const mongoose = require('mongoose');

const StyleSchema = new mongoose.Schema({
  id: String,
  name: String,
  price: Number,
  duration: String,
  desc: String,
  photo: String, // base64 data URL — fine at this scale, move to cloud storage later if it grows
  // Small version of `photo` for Discover, so browsing costs customers little
  // mobile data (~30 KB instead of ~150 KB). Made by the app at upload time.
  photoThumb: { type: String, default: null },
  addedAt: { type: Number, default: null }, // when the service was added ("New looks")
  serviceKey: { type: String, default: null }, // which service this menu item belongs to (lib/catalog.js)
  styleKey: { type: String, default: null },   // which named style, if any
  colorTag: String,
  active: { type: Boolean, default: true },
  // Payment is opt-in per service, per the trust-first philosophy — every
  // existing style implicitly has no payment requirement until a
  // professional explicitly turns one on.
  paymentRequirement: { type: String, enum: ['NO_PAYMENT_REQUIRED', 'DEPOSIT_REQUIRED', 'FULL_PAYMENT_REQUIRED'], default: 'NO_PAYMENT_REQUIRED' },
  depositAmount: { type: Number, default: null }, // minor units, only meaningful when DEPOSIT_REQUIRED
  likes: { type: [String], default: [] }, // clientIds
  reelCount: { type: Number, default: 0 }, // angles in this service's Look Reel (frames live in LookReel)
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
  // Set when an admin issues a temporary password: the next login must
  // choose a new one. Private (stripped from public responses).
  // How this professional works. Empty = not said yet. No one is forced to
  // have a physical shop: home visits, mobile and appointment-only are equal.
  workModes: { type: [{ type: String, enum: ['SALON', 'HOME', 'MOBILE', 'APPOINTMENT'] }], default: [] },
  // Sheeba code (lib/codes.js) and who invited this account, if anyone.
  code: { type: String, unique: true, sparse: true },
  // Join order; #1-1,000 are founding members (lib/members.js). No default on
  // purpose: the unique index must never see two empty values.
  memberNumber: { type: Number },
  legacyCodes: { type: [String], default: [] }, // earlier codes, still accepted
  invitedByType: { type: String, enum: ['stylist', 'customer', null], default: null },
  invitedById: { type: String, default: null },
  // Apprentices (professionals in training) sign up with their supervisor's
  // code; the supervisor confirms, which adds them to the shop's staff access.
  role: { type: String, enum: ['PROFESSIONAL', 'APPRENTICE'], default: 'PROFESSIONAL' },
  supervisorId: { type: String, default: null },
  supervisorStatus: { type: String, enum: ['PENDING', 'APPROVED', 'DECLINED', 'GRADUATED', null], default: null },
  graduatedAt: { type: Number, default: null }, // when they graduated from apprentice to independent professional
  // Age check (only when the admin has it switched on; see lib/age.js).
  ageConfirmedAt: { type: Number, default: null },
  isMinor: { type: Boolean, default: false }, // a 15-17 year old apprentice: never public, no direct bookings
  guardianName: { type: String, default: null },
  guardianPhone: { type: String, default: null },
  guardianConsentAt: { type: Number, default: null },
  // What this professional offers (service keys from lib/catalog.js), and any
  // service they proposed that's waiting for admin approval (shown on their
  // own shop in the meantime).
  services: { type: [String], default: [] },
  city: { type: String, default: null }, // e.g. Accra, Kumasi, London (area = neighbourhood)
  pendingServices: { type: [{ proposalId: String, name: String }], default: [] },
  mustChangePassword: { type: Boolean, default: false },
  passwordChangedAt: { type: Number, default: null },
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
  // Admin team role (see lib/adminRoles.js). null = not an admin. Older admin
  // accounts have isAdmin: true and count as SUPER_ADMIN.
  signupSource: { type: mongoose.Schema.Types.Mixed, default: null }, // where they came from (lib/source.js)
  adminRole: { type: String, enum: ['SUPER_ADMIN', 'VERIFIER', 'MODERATOR', 'SUPPORT', 'ANALYST', 'FIELD_AGENT', null], default: null },
  staffAccess: [{
    stylistId: { type: String, required: true },
    addedAt: { type: Number, default: () => Date.now() },
    // The owner decides, per helper. Phone numbers are hidden by default so a
    // helper can serve the shop's customers without being able to take them.
    canManageBookings: { type: Boolean, default: true },
    canSeePhones: { type: Boolean, default: false },
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
  // Which country this account is in (lib/countries.js). Older accounts: Ghana.
  country: { type: String, default: 'GH' }, // ISO code, checked against lib/worldCountries.js
  // Identity document type for verification (Ghana Card in Ghana; passport,
  // driving licence etc. elsewhere). Ghana Card numbers stay in ghanaCardNum;
  // other documents' numbers go in idNumber.
  idType: { type: String, enum: ['GHANA_CARD', 'PASSPORT', 'DRIVING_LICENCE', 'BRP', 'NATIONAL_ID', null], default: null },
  idNumber: { type: String, default: null },
  // Real coordinates, set only when the professional explicitly opts in via
  // their own device's GPS — never required, never inferred from IP or
  // anything else. Absent for every existing shop until they choose to add it.
  location: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
  },
}, { timestamps: true });
StylistSchema.index({ legacyCodes: 1 });
StylistSchema.index({ memberNumber: 1 }, { unique: true, sparse: true });

module.exports = mongoose.models.Stylist || mongoose.model('Stylist', StylistSchema);
