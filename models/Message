const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  conversationId: { type: String, required: true },
  senderType: { type: String, enum: ['customer', 'stylist', 'system'], required: true },
  senderId: { type: String, default: null }, // null for senderType 'system'
  messageType: { type: String, enum: ['text', 'photo', 'structured'], required: true },
  text: { type: String, default: null },
  photo: { type: String, default: null }, // base64 data URL, same pattern as everywhere else in Sheeba
  // Structured actions are DISPLAY records of real events that happened
  // through the real, existing endpoints (request accept/decline/complete) —
  // never a second path that can itself change a business record. See
  // routes/requests.js, where these are created automatically.
  structuredType: {
    type: String,
    enum: ['request_accepted', 'request_declined', 'service_completed', null],
    default: null,
  },
  structuredData: { type: mongoose.Schema.Types.Mixed, default: null },
  createdAt: { type: Number, default: () => Date.now() },
}, { _id: true });

MessageSchema.index({ conversationId: 1, createdAt: 1 });

module.exports = mongoose.models.Message || mongoose.model('Message', MessageSchema);
