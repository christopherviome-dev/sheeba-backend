const mongoose = require('mongoose');

const CommunityFeedbackSchema = new mongoose.Schema({
  telegramMessageId: { type: Number, required: true },
  telegramChatId: { type: Number, required: true },
  telegramUserId: { type: Number, default: null },
  senderName: { type: String, default: 'Unknown' },
  text: { type: String, required: true },
  handled: { type: Boolean, default: false },
  createdAt: { type: Number, default: () => Date.now() },
});

// Telegram sometimes redelivers the same update — this makes storing it
// twice impossible rather than something we have to remember to check for.
CommunityFeedbackSchema.index({ telegramChatId: 1, telegramMessageId: 1 }, { unique: true });

module.exports = mongoose.models.CommunityFeedback || mongoose.model('CommunityFeedback', CommunityFeedbackSchema);
