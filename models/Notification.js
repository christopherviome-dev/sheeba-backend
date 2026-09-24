const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  recipientId: { type: String, required: true },
  recipientType: { type: String, enum: ['customer', 'stylist'], required: true },
  type: {
    type: String,
    required: true,
    enum: [
      'NEW_MESSAGE', 'REQUEST_CREATED', 'REQUEST_ACCEPTED', 'REQUEST_DECLINED',
      'SERVICE_COMPLETED', 'RATING_RECEIVED', 'SHOP_APPROVED',
      'SHOP_UNDER_REVIEW', 'REPORT_FILED', 'COMMUNITY_FEEDBACK',
      'PAYMENT_SUCCESSFUL', 'PAYMENT_FAILED', 'REFUND_SUCCESSFUL',
      'SERVICE_DUE_SOON', 'SERVICE_OVERDUE',
      'VERIFICATION_SUBMITTED', 'VERIFICATION_APPROVED', 'VERIFICATION_REJECTED',
    ],
  },
  title: { type: String, required: true },
  message: { type: String, default: null },
  // What this notification is about, for the deep-link on click — kept as a
  // simple type+id pair rather than a free-form URL, so the frontend decides
  // exactly how to navigate rather than trusting a stored path.
  entityType: { type: String, enum: ['conversation', 'request', 'shop', 'admin', null], default: null },
  entityId: { type: String, default: null },
  priority: { type: String, enum: ['normal', 'important', 'action_required', 'time_sensitive'], default: 'normal' },
  read: { type: Boolean, default: false },
  createdAt: { type: Number, default: () => Date.now() },
});

NotificationSchema.index({ recipientId: 1, recipientType: 1, createdAt: -1 });

module.exports = mongoose.models.Notification || mongoose.model('Notification', NotificationSchema);
