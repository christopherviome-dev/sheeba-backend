const mongoose = require('mongoose');

// Deliberately minimal for now: this is the identity anchor the future
// Style/Service Record system will attach to. Preference/history fields
// get added once records actually exist to attach — not before.
const CustomerSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true },
  // Which country this account is in (lib/countries.js). Older accounts: Ghana.
  country: { type: String, default: 'GH' }, // ISO code, checked against lib/worldCountries.js
  // Mepluge code (lib/codes.js) and who invited this account, if anyone.
  code: { type: String, unique: true, sparse: true },
  // Join order; #1-1,000 are founding members (lib/members.js). No default on
  // purpose: the unique index must never see two empty values.
  memberNumber: { type: Number },
  legacyCodes: { type: [String], default: [] }, // earlier codes, still accepted
  invitedByType: { type: String, enum: ['stylist', 'customer', null], default: null },
  invitedById: { type: String, default: null },
  // Set when an admin issues a temporary password (see Stylist).
  // Age check (only when the admin has it switched on; see lib/age.js).
  ageConfirmedAt: { type: Number, default: null },
  // Optional feed preferences from onboarding (never shown to professionals):
  // whose styles to show first, and up to 3 favourite styles (lib/catalog.js keys).
  profilePhoto: { type: String, default: null },
  // Continue with Google: the Google account id and its confirmed email (never public).
  googleSub: { type: String, default: null, index: true },
  email: { type: String, default: null },
  emailVerified: { type: Boolean, default: false },
  marketingOptIn: { type: Boolean, default: false }, // said yes to Mepluge news by email
  signupSource: { type: mongoose.Schema.Types.Mixed, default: null }, // where they came from (lib/source.js) // their own picture (checked upload)
  feedFor: { type: String, enum: ['MEN', 'WOMEN', 'BOTH', null], default: null },
  favourites: { type: [String], default: [] },
  onboardedAt: { type: Number, default: null },
  // Admin restrictions: RESTRICTED = can log in but can't book;
  // SUSPENDED / BANNED = can't log in. The reason is shown to them.
  accountStatus: { type: String, enum: ['ACTIVE', 'RESTRICTED', 'SUSPENDED', 'BANNED'], default: 'ACTIVE' },
  restrictionReason: { type: String, default: null },
  restrictedAt: { type: Number, default: null },
  restrictedBy: { type: String, default: null },
  restoredAt: { type: Number, default: null },
  mustChangePassword: { type: Boolean, default: false },
  passwordChangedAt: { type: Number, default: null },
}, { timestamps: true });
CustomerSchema.index({ legacyCodes: 1 });
CustomerSchema.index({ memberNumber: 1 }, { unique: true, sparse: true });

module.exports = mongoose.models.Customer || mongoose.model('Customer', CustomerSchema);
