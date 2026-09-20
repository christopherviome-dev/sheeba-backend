const express = require('express');
const CommunityFeedback = require('../models/CommunityFeedback');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { notifyAllAdmins } = require('./notifications');

const router = express.Router();

// Telegram calls this the moment someone posts in the group. Verified via
// the secret token Telegram echoes back on every call (set once via
// setWebhook — see the deployment steps) so an arbitrary POST from anyone
// else on the internet can't inject fake community feedback.
router.post('/webhook', async (req, res) => {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const got = req.headers['x-telegram-bot-api-secret-token'];
  if (!expected || got !== expected) return res.status(401).json({ error: 'Invalid secret token.' });

  // Always 200 back to Telegram quickly regardless of what's inside — a
  // non-200 makes Telegram retry the same update repeatedly.
  res.json({ ok: true });

  const msg = req.body && req.body.message;
  if (!msg || !msg.text) return; // ignore non-text updates (stickers, joins, etc.) — nothing real to store
  try {
    const senderName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username || 'Unknown';
    const doc = await CommunityFeedback.create({
      telegramMessageId: msg.message_id,
      telegramChatId: msg.chat.id,
      telegramUserId: msg.from ? msg.from.id : null,
      senderName,
      text: msg.text,
    });
    await notifyAllAdmins({ type: 'COMMUNITY_FEEDBACK', title: `Community: ${senderName}`, message: msg.text.slice(0, 100), entityType: 'admin', entityId: doc._id.toString(), priority: 'normal' });
  } catch (e) { /* duplicate delivery of the same update, or non-fatal storage issue — either way, Telegram already got its 200 */ }
});

// Admin: real, stored community feedback — nothing fabricated.
router.get('/feedback', requireAuth, requireAdmin, async (req, res) => {
  const list = await CommunityFeedback.find({}).sort({ createdAt: -1 }).limit(200);
  res.json(list);
});

router.put('/feedback/:id/handled', requireAuth, requireAdmin, async (req, res) => {
  const f = await CommunityFeedback.findByIdAndUpdate(req.params.id, { handled: true }, { new: true });
  if (!f) return res.status(404).json({ error: 'Not found.' });
  res.json(f);
});

module.exports = router;
