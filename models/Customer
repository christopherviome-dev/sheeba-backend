const mongoose = require('mongoose');

// Deliberately minimal for now: this is the identity anchor the future
// Style/Service Record system will attach to. Preference/history fields
// get added once records actually exist to attach — not before.
const CustomerSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.models.Customer || mongoose.model('Customer', CustomerSchema);
