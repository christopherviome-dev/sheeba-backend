const express = require('express');
const { getSetting } = require('../lib/settings');
const router = express.Router();
// Public: which switches affect what signup forms show. Nothing private here.
router.get('/', async (req, res) => {
  res.json({ ageCheck: !!(await getSetting('ageCheck')) });
});
module.exports = router;
