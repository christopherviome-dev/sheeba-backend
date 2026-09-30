const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
// For Render's health check: "OK" only when the database is really connected,
// so a new version only takes over once it can actually serve people.
router.get('/', (req, res) => {
  const up = mongoose.connection.readyState === 1;
  res.status(up ? 200 : 503).json({ ok: up });
});
module.exports = router;
