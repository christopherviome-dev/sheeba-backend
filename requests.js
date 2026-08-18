const express = require('express');
const Request = require('../models/Request');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Public: everyone's requests (used by the app to build the live view — kept simple at this scale)
router.get('/', async (req, res) => {
  const list = await Request.find({});
  res.json(list);
});

// Public: submit a booking request to a specific stylist
router.post('/', async (req, res) => {
  const { stylistId, styleId, clientId, clientName, clientPhone, date, note, meet, emergency, budget, area } = req.body;
  if (!clientName || !clientPhone) return res.status(400).json({ error: 'Name and phone are required.' });
  const status = stylistId ? 'pending' : 'open'; // no stylistId = open/broadcast request
  const r = await Request.create({ stylistId, styleId, clientId, clientName, clientPhone, date, note, meet, emergency, budget, area, status });
  res.json(r);
});

// Auth: stylist accepts/declines/completes one of their own requests
router.put('/:id/status', requireAuth, async (req, res) => {
  const r = await Request.findById(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found.' });
  if (r.stylistId !== req.stylistId && !req.isAdmin) return res.status(403).json({ error: 'Not your request.' });
  r.status = req.body.status;
  r.updatedAt = Date.now();
  await r.save();
  res.json(r);
});

// Auth: stylist claims an open/broadcast request
router.put('/:id/claim', requireAuth, async (req, res) => {
  const r = await Request.findById(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found.' });
  r.stylistId = req.stylistId;
  r.status = 'pending';
  r.updatedAt = Date.now();
  await r.save();
  res.json(r);
});

// Public: client rates a completed request
router.put('/:id/rate', async (req, res) => {
  const r = await Request.findById(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found.' });
  r.rating = req.body.rating;
  await r.save();
  res.json(r);
});

module.exports = router;
