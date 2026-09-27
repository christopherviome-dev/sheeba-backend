const express = require('express');
const { getCatalog } = require('../lib/catalog');
const router = express.Router();
// Public: the services and styles on Sheeba (defaults + admin-approved ones).
router.get('/', async (req, res) => { res.json({ services: await getCatalog() }); });
module.exports = router;
