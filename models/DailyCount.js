const mongoose = require('mongoose');
// Anonymous daily counts for admin trends, e.g. how often a style was searched
// for or opened. No person, account, phone or device is ever recorded: just
// the day, what kind of thing, which style, and how many times.
const DailyCountSchema = new mongoose.Schema({
  day: { type: String, required: true },   // "2026-09-28" (UTC)
  kind: { type: String, enum: ['search', 'inspiration'], required: true },
  key: { type: String, required: true },   // a style key from lib/catalog.js
  count: { type: Number, default: 0 },
});
DailyCountSchema.index({ day: 1, kind: 1, key: 1 }, { unique: true });
module.exports = mongoose.models.DailyCount || mongoose.model('DailyCount', DailyCountSchema);
