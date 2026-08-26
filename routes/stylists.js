const express = require('express');
const Stylist = require('../models/Stylist');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
module.exports = router;
