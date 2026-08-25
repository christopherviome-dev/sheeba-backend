const express = require('express');
const Stylist = require('../models/Stylist');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function publicStylist(s) {
  const obj = s.toObject ? s.toObject() : s;
  delete obj.passwordHash;
  delete obj.ghanaCardNum;
  delete obj.verifyPhoto;
  return obj;
}

function uid(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 9);
}

// Public: browse everyone
router.get('/', async (req, res) => {
  try {
    const list = await Stylist.find({});
    res.json(list.map(publicStylist));
  } catch (error) {
    console.error('GET /api/stylists failed:', error);
    res.status(500).json({ error: 'Unable to load stylists.' });
  }
});

// Auth: get my own record
router.get('/me', requireAuth, async (req, res) => {
  const st = await Stylist.findById(req.stylistId);
  if (!st) return res.status(404).json({ error: 'Not found.' });
  res.json(publicStylist(st));
});

// Auth: update my page
router.put('/me', requireAuth, async (req, res) => {
  const { salonName, name, category, area, bio, coverPhoto } = req.body;

  const st = await Stylist.findById(req.stylistId);
  if (!st) return res.status(404).json({ error: 'Not found.' });

  if (salonName !== undefined) st.salonName = salonName;
  if (name !== undefined) st.name = name;
  if (category !== undefined) st.category = category;
  if (area !== undefined) st.area = area;
  if (bio !== undefined) st.bio = bio;
  if (coverPhoto !== undefined) st.coverPhoto = coverPhoto;

  await st.save();
  res.json(publicStylist(st));
});

// Auth: mark myself active
router.post('/me/touch', requireAuth, async (req, res) => {
  await Stylist.findByIdAndUpdate(req.stylistId, {
    lastActiveAt: Date.now()
  });

  res.json({ ok: true });
});

// Auth: add a style/service
router.post('/me/styles', requireAuth, async (req, res) => {
  const { name, price, duration, desc, photo } = req.body;

  if (!name || !price) {
    return res.status(400).json({
      error: 'Name and price are required.'
    });
  }

  const st = await Stylist.findById(req.stylistId);

  if (!st) {
    return res.status(404).json({ error: 'Not found.' });
  }

  st.styles.push({
    id: uid('sty'),
    name,
    price,
    duration,
    desc,
    photo,
    likes: []
  });

  await st.save();

  res.json(publicStylist(st));
});

// Auth: update a style's price
router.put('/me/styles/:styleId', requireAuth, async (req, res) => {
  const st = await Stylist.findById(req.stylistId);

  if (!st) {
    return res.status(404).json({ error: 'Not found.' });
  }

  const style = st.styles.find(
    s => s.id === req.params.styleId
  );

  if (!style) {
    return res.status(404).json({
      error: 'Style not found.'
    });
  }

  if (req.body.price !== undefined) {
    style.price = req.body.price;
  }

  await st.save();

  res.json(publicStylist(st));
});

// Auth: remove a style
router.delete('/me/styles/:styleId', requireAuth, async (req, res) => {
  const st = await Stylist.findById(req.stylistId);

  if (!st) {
    return res.status(404).json({ error: 'Not found.' });
  }

  st.styles = st.styles.filter(
    s => s.id !== req.params.styleId
  );

  await st.save();

  res.json(publicStylist(st));
});

// Auth: submit ID verification
router.post('/me/verify', requireAuth, async (req, res) => {
  const { ghanaCardNum, verifyPhoto } = req.body;

  if (!ghanaCardNum && !verifyPhoto) {
    return res.status(400).json({
      error: 'Add a Ghana Card number, a photo, or both.'
    });
  }

  const st = await Stylist.findById(req.stylistId);

  if (!st) {
    return res.status(404).json({ error: 'Not found.' });
  }

  if (ghanaCardNum) st.ghanaCardNum = ghanaCardNum;
  if (verifyPhoto) st.verifyPhoto = verifyPhoto;

  st.pendingReview = true;

  await st.save();

  res.json(publicStylist(st));
});

// Admin: approve a stylist
router.post('/:id/approve', requireAuth, requireAdmin, async (req, res) => {
  const st = await Stylist.findByIdAndUpdate(
    req.params.id,
    {
      verified: true,
      pendingReview: false
    },
    {
      new: true
    }
  );

  if (!st) {
    return res.status(404).json({ error: 'Not found.' });
  }

  res.json(publicStylist(st));
});

// Public: follow/unfollow
router.post('/:id/follow', async (req, res) => {
  const { clientId } = req.body;

  if (!clientId) {
    return res.status(400).json({
      error: 'Missing clientId.'
    });
  }

  const st = await Stylist.findById(req.params.id);

  if (!st) {
    return res.status(404).json({
      error: 'Not found.'
    });
  }

  const i = st.followers.indexOf(clientId);

  if (i >= 0) {
    st.followers.splice(i, 1);
  } else {
    st.followers.push(clientId);
  }

  await st.save();

  res.json(publicStylist(st));
});

// Public: like/unlike a style
router.post('/:id/styles/:styleId/like', async (req, res) => {
  const { clientId } = req.body;

  if (!clientId) {
    return res.status(400).json({
      error: 'Missing clientId.'
    });
  }

  const st = await Stylist.findById(req.params.id);

  if (!st) {
    return res.status(404).json({
      error: 'Not found.'
    });
  }

  const style = st.styles.find(
    s => s.id === req.params.styleId
  );

  if (!style) {
    return res.status(404).json({
      error: 'Style not found.'
    });
  }

  const i = style.likes.indexOf(clientId);

  if (i >= 0) {
    style.likes.splice(i, 1);
  } else {
    style.likes.push(clientId);
  }

  await st.save();

  res.json(publicStylist(st));
});

module.exports = router;
