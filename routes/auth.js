const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Stylist = require('../models/Stylist');
const Activity = require('../models/Activity');
const Customer = require('../models/Customer');
const PasswordResetRequest = require('../models/PasswordResetRequest');
const { notifyAllAdmins } = require('./notifications');
const { requireAuth } = require('../middleware/auth');
const { phoneCandidates, checkNewPassword, toE164 } = require('../lib/passwords');
const { uniqueCode } = require('../lib/codes');
const { getCountry, checkCountry } = require('../lib/countries');
const { recordInvite } = require('../lib/invites');
const { normalizeCode, codeQuery } = require('../lib/codes');
const { nextMemberNumber, friendlyCode, FOUNDING_LIMIT } = require('../lib/members');
const { getSetting } = require('../lib/settings');
const attempts = require('../lib/attempts');
const { resolveSource } = require('../lib/source');
// Compared against when no account matches, so a wrong number takes as long
// as a wrong password: a genuine hash of random text, made fresh at startup.
const DUMMY_HASH = bcrypt.hashSync(require('crypto').randomBytes(16).toString('hex'), 10);
const { checkAge } = require('../lib/age');
const { notify } = require('./notifications');

const router = express.Router();
const COLORS = ['#e63875', '#4b2069', '#f5a623', '#b81e58', '#33124a', '#c97d0a'];

function makeToken(stylist) {
  return jwt.sign({ id: stylist._id.toString(), isAdmin: stylist.isAdmin }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function publicStylist(s) {
  const obj = s.toObject ? s.toObject() : { ...s }; // always a copy: never alter the stored record
  delete obj.passwordHash;
  // Not needed by the app after login/signup, so never sent (data minimisation).
  delete obj.guardianName;
  delete obj.guardianPhone;
  delete obj.guardianConsentAt;
  return obj;
}

// Register a new stylist account (creates a bare account — they fill in salon details after)
router.post('/register', async (req, res) => {
  const countryCheck = checkCountry(req.body.country);
  if (!countryCheck.ok) return res.status(400).json({ error: countryCheck.error });
  const country = countryCheck.value;
  const phoneCheck = toE164(req.body.phone, country);
  if (!phoneCheck.ok) return res.status(400).json({ error: phoneCheck.error });
  // An apprentice names their supervisor by the supervisor's Sheeba code.
  let supervisor = null;
  const isApprentice = req.body.role === 'APPRENTICE';
  if (isApprentice) {
    const sc = normalizeCode(req.body.supervisorCode);
    supervisor = sc ? await Stylist.findOne(codeQuery(sc)) : null;
    if (!supervisor || supervisor.role === 'APPRENTICE') return res.status(400).json({ error: 'Enter your supervisor\u2019s Sheeba code (they can find it under My Shop, Share & earn).' });
  }
  let ageFields = {};
  if (await getSetting('ageCheck')) {
    const a = checkAge(req.body, { apprentice: isApprentice, country });
    if (!a.ok) return res.status(400).json({ error: a.error });
    ageFields = a.value;
  }
  try {
    const { phone, password, name } = req.body;
    if (!phone || !password || !name) return res.status(400).json({ error: 'Phone, password, and name are required.' });
    const existing = await Stylist.findOne({ phone: { $in: phoneCandidates(phone) } });
    if (existing) return res.status(400).json({ error: 'An account with this phone number already exists.' });
    const memberNumber = await nextMemberNumber({ Stylist, Customer });
    const passwordHash = await bcrypt.hash(password, 10);
    const signupSource = await resolveSource(req.body.source); // where they came from (lib/source.js)
    const stylist = await Stylist.create({
      signupSource,
      phone: phoneCheck.value, passwordHash, name,
      memberNumber, code: friendlyCode(name, memberNumber),
      country, currency: getCountry(country).currency, // a shop prices in its own country's currency
      ...(isApprentice ? { role: 'APPRENTICE', supervisorId: supervisor._id.toString(), supervisorStatus: 'PENDING' } : {}),
      ...ageFields,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      status: 'UNDER_REVIEW', // explicit, though also the schema default — every new shop starts hidden from public Discovery until an admin approves it
    });
    try { await Activity.create({ stylistId: stylist._id.toString(), type: 'ACCOUNT_CREATED' }); } catch (e) { /* non-fatal */ }
    await recordInvite({ inviteCode: req.body.inviteCode, newType: 'stylist', newDoc: stylist, Stylist, Customer, notify });
    if (memberNumber === FOUNDING_LIMIT) await notifyAllAdmins({ type: 'MEMBER_MILESTONE', title: `\u{1F389} Sheeba's ${FOUNDING_LIMIT}th member just joined: ${stylist.name}`, message: 'The founding members are complete.', entityType: 'admin', entityId: stylist._id.toString(), priority: 'important' });
    if (isApprentice) await notify({ recipientId: supervisor._id.toString(), recipientType: 'stylist', type: 'APPRENTICE_REQUEST', title: `${stylist.name} wants to join your shop as an apprentice`, message: 'Confirm or decline in My Shop \u2192 Account.', entityType: 'shop', entityId: supervisor._id.toString(), priority: 'action_required' });
    await notifyAllAdmins({ type: 'SHOP_UNDER_REVIEW', title: `New shop awaiting review: ${name}`, entityType: 'admin', entityId: stylist._id.toString(), priority: 'action_required' });
    res.json({ token: makeToken(stylist), stylist: publicStylist(stylist) });
  } catch (e) {
    res.status(500).json({ error: 'Could not create account.' });
  }
});

// Log in
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    // Password guessing: paused after too many wrong attempts (lib/attempts.js).
    const keys = attempts.loginKeys('stylist', phone, req.ip);
    const blocked = attempts.loginBlocked(keys);
    if (blocked.blocked) return res.status(429).json({ error: attempts.LOCKED_MESSAGE(blocked.retryMinutes) });
    const stylist = await Stylist.findOne({ phone: { $in: phoneCandidates(phone) } });
    // The SAME answer, and the same amount of work, whether or not the number
    // has an account: otherwise anyone could check who uses Sheeba.
    const ok = await bcrypt.compare(String(password || ''), stylist ? stylist.passwordHash : DUMMY_HASH);
    if (!stylist || !ok) {
      attempts.loginFailed(keys);
      return res.status(401).json({ error: 'That phone number and password don\u2019t match. Check both, or use "Forgot password".' });
    }
    attempts.loginSucceeded(keys);
    if (['SUSPENDED', 'BANNED', 'DEACTIVATED'].includes(stylist.accountStatus)) {
      return res.status(403).json({ error: `This account is ${stylist.accountStatus.toLowerCase()}${stylist.restrictionReason ? ': ' + stylist.restrictionReason : '.'}` });
    }
    res.json({ token: makeToken(stylist), stylist: publicStylist(stylist), mustChangePassword: !!stylist.mustChangePassword });
  } catch (e) {
    res.status(500).json({ error: 'Login failed.' });
  }
});

// "Forgot password?" for both account types. Always gives the same answer,
// whether or not the number is registered, so it can't be used to check
// who uses Sheeba. A real account gets at most one open request at a time.
router.post('/forgot-password', async (req, res) => {
  const reply = { ok: true, message: 'If an account uses this number, Sheeba will call that number to confirm it\'s you, then give you a temporary password.' };
  // Someone submitting many numbers to flood the admin's queue: paused per address.
  const ipKey = `reset-ip:${req.ip || 'unknown'}`;
  const blocked = attempts.status([ipKey]);
  if (blocked.blocked) return res.status(429).json({ error: `Too many requests. Please wait ${blocked.retryMinutes} minutes and try again.` });
  attempts.fail([[ipKey, attempts.LIMITS.resetIp]]);
  try {
    const accountType = req.body.accountType === 'customer' ? 'customer' : 'stylist';
    const Model = accountType === 'customer' ? Customer : Stylist;
    const account = await Model.findOne({ phone: { $in: phoneCandidates(req.body.phone) } });
    if (account) {
      const accountId = account._id.toString();
      const open = await PasswordResetRequest.findOne({ accountType, accountId, status: 'OPEN' });
      if (!open) {
        await PasswordResetRequest.create({ accountType, accountId });
        await notifyAllAdmins({ type: 'PASSWORD_RESET_REQUESTED', title: `Password help requested: ${account.salonName || account.name}`, entityType: 'admin', entityId: accountId, priority: 'action_required' });
      }
    }
  } catch (e) { /* same reply either way: never reveal whether the number exists */ }
  res.json(reply);
});

// A logged-in professional changes their own password. The current
// password is required, so a borrowed phone with an open session isn't
// enough to take over the account.
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const problem = checkNewPassword(newPassword);
  if (problem) return res.status(400).json({ error: problem });
  const stylist = await Stylist.findById(req.stylistId);
  if (!stylist) return res.status(404).json({ error: 'Account not found.' });
  const ok = typeof currentPassword === 'string' && await bcrypt.compare(currentPassword, stylist.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Your current password is incorrect.' });
  if (await bcrypt.compare(newPassword, stylist.passwordHash)) return res.status(400).json({ error: 'Choose a password different from the current one.' });
  stylist.passwordHash = await bcrypt.hash(newPassword, 10);
  stylist.mustChangePassword = false;
  stylist.passwordChangedAt = Date.now();
  await stylist.save();
  res.json({ ok: true });
});

module.exports = router;
