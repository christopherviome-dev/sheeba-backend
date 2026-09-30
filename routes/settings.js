const express = require('express');
const { getSetting } = require('../lib/settings');
const router = express.Router();
// Public: which switches affect what signup forms show. Nothing private here.
router.get('/', async (req, res) => {
  const on = async (k) => !!(await getSetting(k));
  res.json({
    ageCheck: await on('ageCheck'), pauseSignups: await on('pauseSignups'), pauseBookings: await on('pauseBookings'),
    messages: await on('messages'), inviteRewards: await on('inviteRewards'),
    announcement: String((await getSetting('announcement')) || ''),
    googleClientId: process.env.GOOGLE_CLIENT_ID || null, // public by design; the button shows only when set
  });
});
module.exports = router;
