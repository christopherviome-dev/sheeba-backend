const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Stylist = require('../models/Stylist');

const router = express.Router();
const COLORS = ['#e63875', '#4b2069', '#f5a623', '#b81e58', '#33124a', '#c97d0a'];

function makeToken(stylist) {
  return jwt.sign({ id: stylist._id.toString(), isAdmin: stylist.isAdmin }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function publicStylist(s) {
  const obj = s.toObject ? s.toObject() : s;
  delete obj.passwordHash;
  return obj;
}

// Register a new stylist account (creates a bare account — they fill in salon details after)
router.post('/register', async (req, res) => {
  try {
    const { phone, password, name } = req.body;
    if (!phone || !password || !name) return res.status(400).json({ error: 'Phone, password, and name are required.' });
    const existing = await Stylist.findOne({ phone });
    if (existing) return res.status(400).json({ error: 'An account with this phone number already exists.' });
    const passwordHash = await bcrypt.hash(password, 10);
    const stylist = await Stylist.create({
      phone, passwordHash, name,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    });
    res.json({ token: makeToken(stylist), stylist: publicStylist(stylist) });
  } catch (e) {
    res.status(500).json({ error: 'Could not create account.' });
  }
});

// Log in
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const stylist = await Stylist.findOne({ phone });
    if (!stylist) return res.status(401).json({ error: 'No account found with that phone number.' });
    const ok = await bcrypt.compare(password, stylist.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Incorrect password.' });
    res.json({ token: makeToken(stylist), stylist: publicStylist(stylist) });
  } catch (e) {
    res.status(500).json({ error: 'Login failed.' });
  }
});

module.exports = router;
