const express = require('express');
const Stylist = require('../models/Stylist');
const Customer = require('../models/Customer');
const { normalizeCode } = require('../lib/codes');

const router = express.Router();

// What a scanned QR code or a sheeba.online/u/CODE link leads to.
// A live professional: their shop (public anyway). Anyone else (a customer,
// or a shop still awaiting approval): nothing personal at all, just that
// they're a Sheeba member, so the page can offer to join with their invite.
router.get('/:code', async (req, res) => {
  const code = normalizeCode(req.params.code);
  if (!code) return res.status(404).json({ error: 'That isn\u2019t a Sheeba code.' });
  const st = await Stylist.findOne({ code });
  if (st && st.status === 'APPROVED' && (st.accountStatus || 'ACTIVE') === 'ACTIVE') {
    return res.json({ type: 'professional', code, id: st._id, name: st.salonName || st.name });
  }
  if (st || await Customer.exists({ code })) return res.json({ type: 'member', code });
  res.status(404).json({ error: 'No one on Sheeba has this code.' });
});

module.exports = router;
