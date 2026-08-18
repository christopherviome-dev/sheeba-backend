const express = require('express');
const Report = require('../models/Report');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Public: file a report — no login needed, this must stay easy to use
router.post('/', async (req, res) => {
  const { stylistId, detail, contact, urgent } = req.body;
  if (!detail) return res.status(400).json({ error: 'Please describe what happened.' });
  const r = await Report.create({ stylistId, detail, contact, urgent });
  res.json(r);
});

// Admin only: view all reports
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  const list = await Report.find({}).sort({ createdAt: -1 });
  res.json(list);
});

// Admin only: mark resolved
router.put('/:id/resolve', requireAuth, requireAdmin, async (req, res) => {
  const r = await Report.findByIdAndUpdate(req.params.id, { resolved: true }, { new: true });
  res.json(r);
});

module.exports = router;
