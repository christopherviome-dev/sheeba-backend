const mongoose = require('mongoose');

// Deliberately minimal for now: this is the identity anchor the future
// Style/Service Record system will attach to. Preference/history fields
// get added once records actually exist to attach — not before.
const CustomerSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true },
  // Sheeba code (lib/codes.js) and who invited this account, if anyone.
  code: { type: String, unique: true, sparse: true },
  invitedByType: { type: String, enum: ['stylist', 'customer', null], default: null },
  invitedById: { type: String, default: null },
  // Set when an admin issues a temporary password (see Stylist).
  mustChangePassword: { type: Boolean, default: false },
  passwordChangedAt: { type: Number, default: null },
}, { timestamps: true });

module.exports = mongoose.models.Customer || mongoose.model('Customer', CustomerSchema);
