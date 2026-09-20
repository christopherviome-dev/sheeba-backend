const express = require('express');
const Report = require('../models/Report');
const AdminAction = require('../models/AdminAction');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { notifyAllAdmins } = require('./notifications');

const router = express.Router();

// Public: file a report — no login needed, this must stay easy to use
router.post('/', async (req, res) => {
  const { stylistId, detail, contact, urgent } = req.body;
  if (!detail) return res.status(400).json({ error: 'Please describe what happened.' });
  const r = await Report.create({ stylistId, detail, contact, urgent });
  await notifyAllAdmins({ type: 'REPORT_FILED', title: urgent ? 'Urgent report filed' : 'New report filed', message: detail.slice(0, 80), entityType: 'admin', entityId: r._id.toString(), priority: urgent ? 'time_sensitive' : 'important' });
  res.json(r);
});

// Admin only: view all reports
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  const list = await Report.find({}).sort({ createdAt: -1 });
  res.json(list);
});

// Admin only: mark resolved — kept exactly as-is for backward compatibility
// with the existing frontend, which already calls this.
router.put('/:id/resolve', requireAuth, requireAdmin, async (req, res) => {
  const r = await Report.findByIdAndUpdate(req.params.id, { resolved: true, state: 'RESOLVED' }, { new: true });
  try { await AdminAction.create({ adminId: req.stylistId, action: 'REPORT_RESOLVED', targetType: 'report', targetId: req.params.id }); } catch (e) { /* non-fatal */ }
  res.json(r);
});

// Admin only: the real case workflow — move a report through its actual
// states, with an optional private note and a permanent audit record of
// who changed what.
router.put('/:id/state', requireAuth, requireAdmin, async (req, res) => {
  const { state, adminNotes } = req.body;
  const valid = ['OPEN', 'UNDER_REVIEW', 'NEEDS_INFORMATION', 'ESCALATED', 'RESOLVED', 'DISMISSED'];
  if (!valid.includes(state)) return res.status(400).json({ error: 'Invalid state.' });
  const update = { state, resolved: ['RESOLVED', 'DISMISSED'].includes(state) };
  if (adminNotes !== undefined) update.adminNotes = adminNotes;
  const r = await Report.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!r) return res.status(404).json({ error: 'Not found.' });
  try { await AdminAction.create({ adminId: req.stylistId, action: 'REPORT_STATE_CHANGED', targetType: 'report', targetId: req.params.id, meta: { state } }); } catch (e) { /* non-fatal */ }
  res.json(r);
});

module.exports = router;
