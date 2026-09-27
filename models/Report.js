const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
  stylistId: String,
  detail: String,
  contact: String,
  urgent: { type: Boolean, default: false },
  // Who the report is about: a professional (stylistId, kept for the older
  // site) or a customer (reported by a professional they had a booking with).
  targetType: { type: String, enum: ['stylist', 'customer', null], default: 'stylist' },
  targetId: { type: String, default: null },
  requestId: { type: String, default: null }, // the booking it relates to, if any
  category: { type: String, enum: ['NO_SHOW', 'UNSAFE', 'HARASSMENT', 'FRAUD', 'POOR_SERVICE', 'FAKE_PROFILE', 'OTHER', null], default: null },
  reporterType: { type: String, enum: ['stylist', 'customer', null], default: null }, // when logged in
  reporterId: { type: String, default: null },
  // `resolved` stays for backward compatibility with existing frontend
  // logic — `state` is the new, real workflow. Kept in sync: RESOLVED or
  // DISMISSED always sets resolved=true, everything else keeps it false.
  resolved: { type: Boolean, default: false },
  state: { type: String, enum: ['OPEN', 'UNDER_REVIEW', 'NEEDS_INFORMATION', 'ESCALATED', 'RESOLVED', 'DISMISSED'], default: 'OPEN' },
  adminNotes: { type: String, default: null }, // private, admin-only, never exposed publicly
  createdAt: { type: Number, default: () => Date.now() },
});

module.exports = mongoose.models.Report || mongoose.model('Report', ReportSchema);
