const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
  stylistId: String,
  detail: String,
  contact: String,
  urgent: { type: Boolean, default: false },
  resolved: { type: Boolean, default: false },
  createdAt: { type: Number, default: () => Date.now() },
});

module.exports = mongoose.models.Report || mongoose.model('Report', ReportSchema);
