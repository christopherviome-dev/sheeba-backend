// Public: browse everyone
router.get('/', async (req, res) => {
  try {
    const list = await Stylist.find({})
      .select(
        '-passwordHash -ghanaCardNum -verifyPhoto -followers'
      )
      .lean();

    res.json(list);
  } catch (error) {
    console.error('GET /api/stylists failed:', error);

    res.status(500).json({
      error: 'Unable to load stylists.'
    });
  }
});
