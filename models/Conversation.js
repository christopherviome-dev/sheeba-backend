const mongoose = require('mongoose');

const ConversationSchema = new mongoose.Schema({
  customerId: { type: String, required: true },
  customerName: { type: String, default: null }, // snapshot at creation — avoids needing a public customer-lookup endpoint
  stylistId: { type: String, required: true },
  requestId: { type: String, default: null }, // the real request this conversation is about, if any
  status: { type: String, enum: ['active', 'closed'], default: 'active' },
  lastMessageAt: { type: Number, default: () => Date.now() },
  customerUnread: { type: Boolean, default: false },
  stylistUnread: { type: Boolean, default: false },
}, { timestamps: true });

// One conversation per customer+stylist pair — reused across multiple
// requests over time, since the relationship is ongoing, not per-booking.
ConversationSchema.index({ customerId: 1, stylistId: 1 }, { unique: true });

module.exports = mongoose.models.Conversation || mongoose.model('Conversation', ConversationSchema);
