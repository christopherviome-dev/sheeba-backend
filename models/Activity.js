const mongoose = require('mongoose');

// Records meaningful platform events only — never raw clicks or page-views.
// This is server-authoritative: every entry here is created from inside a
// route that already required real auth/ownership/validation to reach, so
// refreshing a page or clicking repeatedly cannot manufacture entries —
// there is no route that lets a client create an Activity record directly.
const ActivitySchema = new mongoose.Schema({
  stylistId: { type: String, default: null },
  clientId: { type: String, default: null },
  type: {
    type: String,
    required: true,
    enum: [
      'ACCOUNT_CREATED', 'SHOP_APPROVED', 'WORK_UPLOADED', 'SERVICE_ADDED',
      'FOLLOW_RECEIVED', 'REQUEST_CREATED', 'REQUEST_ACCEPTED',
      'SERVICE_COMPLETED', 'RATING_RECEIVED', 'SHOP_VISITED',
      'STYLE_SAVED', 'SEARCH_PERFORMED', 'SHOP_SHARED', 'REFERRAL_VISIT', 'REFERRED_REQUEST_CREATED',
    ],
  },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Number, default: () => Date.now() },
});

module.exports = mongoose.models.Activity || mongoose.model('Activity', ActivitySchema);
