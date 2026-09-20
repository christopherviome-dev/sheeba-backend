const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
  stylistId: String,
  detail: String,
  contact: String,
  urgent: { type: Boolean, default: false },
  // `resolved` stays for backward compatibility with existing frontend
  // logic — `state` is the new, real workflow. Kept in sync: RESOLVED or
  // DISMISSED always sets resolved=true, everything else keeps it false.
  resolved: { type: Boolean, default: false },
  state: { type: String, enum: ['OPEN', 'UNDER_REVIEW', 'NEEDS_INFORMATION', 'ESCALATED', 'RESOLVED', 'DISMISSED'], default: 'OPEN' },
  adminNotes: { type: String, default: null }, // private, admin-only, never exposed publicly
  createdAt: { type: Number, default: () => Date.now() },
});

module.exports = mongoose.models.Report || mongoose.model('Report', ReportSchema);
