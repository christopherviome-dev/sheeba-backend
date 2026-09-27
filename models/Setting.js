const mongoose = require('mongoose');
// Admin switches, one document per setting (e.g. { _id: 'ageCheck', value: true }).
const SettingSchema = new mongoose.Schema({
  _id: String,
  value: { type: mongoose.Schema.Types.Mixed, default: null },
  updatedAt: { type: Number, default: () => Date.now() },
  updatedBy: { type: String, default: null },
});
module.exports = mongoose.models.Setting || mongoose.model('Setting', SettingSchema);
