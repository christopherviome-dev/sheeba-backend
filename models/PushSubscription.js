const mongoose = require('mongoose');
// One phone/browser that asked for Mepluge alerts (a person can have several).
const PushSubscriptionSchema = new mongoose.Schema({
  ownerType: { type: String, enum: ['stylist', 'customer'], required: true },
  ownerId: { type: String, required: true, index: true },
  endpoint: { type: String, required: true, unique: true },
  keys: { p256dh: { type: String, required: true }, auth: { type: String, required: true } },
  createdAt: { type: Number, default: () => Date.now() },
  lastSentAt: { type: Number, default: null },
});
module.exports = mongoose.models.PushSubscription || mongoose.model('PushSubscription', PushSubscriptionSchema);
