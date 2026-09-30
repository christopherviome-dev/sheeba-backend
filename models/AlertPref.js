const mongoose = require('mongoose');
// Which alert groups ring a person's phone (lib/alertPrefs.js). Kept apart from
// the account itself; no row = the starting choice.
const AlertPrefSchema = new mongoose.Schema({
  ownerType: { type: String, enum: ['stylist', 'customer'], required: true },
  ownerId: { type: String, required: true },
  prefs: { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedAt: { type: Number, default: () => Date.now() },
});
AlertPrefSchema.index({ ownerType: 1, ownerId: 1 }, { unique: true });
module.exports = mongoose.models.AlertPref || mongoose.model('AlertPref', AlertPrefSchema);
