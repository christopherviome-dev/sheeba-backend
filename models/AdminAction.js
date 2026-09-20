const mongoose = require('mongoose');

// Append-only by convention (no update/delete route is ever built against
// this model) — a real accountability trail for every admin-power action,
// not just the ones that happen to touch money or bans.
const AdminActionSchema = new mongoose.Schema({
  adminId: { type: String, required: true },
  action: {
    type: String,
    required: true,
    enum: [
      'SHOP_APPROVED', 'VERIFICATION_APPROVED', 'REPORT_RESOLVED', 'REPORT_STATE_CHANGED',
      'ACCOUNT_RESTRICTED', 'ACCOUNT_RESTORED',
    ],
  },
  targetType: { type: String, enum: ['stylist', 'report'], required: true },
  targetId: { type: String, required: true },
  reason: { type: String, default: null },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Number, default: () => Date.now() },
});

AdminActionSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
AdminActionSchema.index({ adminId: 1, createdAt: -1 });

module.exports = mongoose.models.AdminAction || mongoose.model('AdminAction', AdminActionSchema);
