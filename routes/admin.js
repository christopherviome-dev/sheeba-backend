const express = require('express');
const AdminAction = require('../models/AdminAction');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/audit', requireAuth, requireAdmin, async (req, res) => {
  const list = await AdminAction.find({}).sort({ createdAt: -1 }).limit(200);
  res.json(list);
});

module.exports = router;
