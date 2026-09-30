const express = require('express');
const CommunityFeedback = require('../models/CommunityFeedback');
const { requireAuth, requirePermission } = require('../middleware/auth');
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
router.get('/feedback', requireAuth, requirePermission('telegram'), async (req, res) => {
  const list = await CommunityFeedback.find({}).sort({ createdAt: -1 }).limit(200);
  res.json(list);
});

router.put('/feedback/:id/handled', requireAuth, requirePermission('telegram'), async (req, res) => {
  let f = null;
  try { f = await CommunityFeedback.findByIdAndUpdate(req.params.id, { handled: true }, { new: true }); } catch (e) { /* a bad link */ }
  if (!f) return res.status(404).json({ error: 'Not found.' });
  res.json(f);
});

// ---- Talking back to Telegram (needs TELEGRAM_BOT_TOKEN on the server) ----
const tg = async (method, body) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, description: 'The bot token is not set on the server yet.' };
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    return await r.json();
  } catch (e) { return { ok: false, description: 'Telegram could not be reached. Try again in a minute.' }; } finally { clearTimeout(timer); }
};
const webhookUrl = () => (process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_API_URL || '').replace(/\/$/, '') + '/api/telegram/webhook';

// Is Telegram working? In plain words, with what's missing.
router.get('/status', requireAuth, requirePermission('telegram'), async (req, res) => {
  const tokenSet = !!process.env.TELEGRAM_BOT_TOKEN, secretSet = !!process.env.TELEGRAM_WEBHOOK_SECRET;
  let connected = false, lastError = null, bot = null;
  if (tokenSet) {
    const me = await tg('getMe');
    if (me.ok) bot = me.result.username;
    const info = await tg('getWebhookInfo');
    if (info.ok) { connected = info.result.url === webhookUrl() && secretSet; lastError = info.result.last_error_message || null; }
  }
  res.json({ tokenSet, secretSet, bot, connected, lastError });
});

// One button: connect the bot to this server (only its secret-protected address, only messages).
router.post('/connect', requireAuth, requirePermission('telegram'), async (req, res) => {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_WEBHOOK_SECRET) return res.status(400).json({ error: 'Add TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET on Render first.' });
  if (!/^https:\/\//.test(webhookUrl())) return res.status(400).json({ error: "The server doesn't know its own address." });
  const r = await tg('setWebhook', { url: webhookUrl(), secret_token: process.env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message'], drop_pending_updates: false });
  if (!r.ok) return res.status(502).json({ error: r.description || 'Telegram said no.' });
  res.json({ ok: true });
});

// Answer someone in the group, as a reply to their message.
router.post('/feedback/:id/reply', requireAuth, requirePermission('telegram'), async (req, res) => {
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  if (text.length < 2) return res.status(400).json({ error: 'Write your answer first.' });
  if (text.length > 1000) return res.status(400).json({ error: 'Keep the answer under 1000 characters.' });
  let f = null;
  try { f = await CommunityFeedback.findById(req.params.id); } catch (e) { /* a bad link */ }
  if (!f) return res.status(404).json({ error: 'Not found.' });
  const r = await tg('sendMessage', { chat_id: f.telegramChatId, text, reply_parameters: { message_id: f.telegramMessageId, allow_sending_without_reply: true } });
  if (!r.ok) return res.status(502).json({ error: r.description || 'Telegram did not accept the answer.' });
  const Stylist = require('../models/Stylist');
  const me = await Stylist.findById(req.stylistId, 'name');
  f.replies = [...(f.replies || []), { text, byName: (me && me.name) || 'Mepluge', at: Date.now() }];
  f.handled = true;
  await f.save();
  res.json(f);
});

module.exports = router;
