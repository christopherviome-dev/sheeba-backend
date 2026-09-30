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
      'PASSWORD_RESET_REQUESTED',
      'INVITE_JOINED', 'INVITE_REWARD_EARNED', 'INVITE_REWARD_PAID',
      'APPRENTICE_REQUEST', 'APPRENTICE_APPROVED', 'APPRENTICE_DECLINED', 'STAFF_ACCESS_GRANTED', 'CUSTOMER_CHECKED_IN', 'MEMBER_MILESTONE', 'SERVICE_PROPOSED', 'SERVICE_APPROVED', 'SERVICE_REJECTED', 'ACCOUNT_RESTRICTED', 'ACCOUNT_RESTORED', 'TRAINING_UPDATE', 'APPRENTICE_GRADUATED', 'ADMIN_ROLE', 'FRESH_LOOK',
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

// Every alert also goes to the person's phone(s), with the phone's own sound.
// Fire-and-forget: a phone alert failing never affects the alert itself.
NotificationSchema.post('save', function (doc) {
  try {
    require('../lib/push').sendPush(doc.recipientType, doc.recipientId, { title: doc.title, body: doc.message || '', url: '/notifications', tag: doc.type }).catch(() => {});
  } catch (e) { /* ignore */ }
});

module.exports = mongoose.models.Notification || mongoose.model('Notification', NotificationSchema);
