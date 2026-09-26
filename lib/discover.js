// The lean, public-safe shop card used by Discover and a customer's Saved
// shops: small thumbnails, no private data (no phone, ID documents, legal
// name, follower/like ID lists or cover photos). See routes/stylists.js.
const { COUNTRIES, countryOf } = require('./countries');

const DISCOVER_SHOPS = 40;
const DISCOVER_SERVICES = 12;
const small = (photo, max) => (typeof photo === 'string' && photo.length <= max ? photo : null);

function discoverCard(s, weekVisits = 0) {
  const work = (s.styles || [])
    .filter((x) => x.active !== false)
    .map((x) => ({
      id: x.id,
      name: x.name,
      price: x.price,
      duration: x.duration || null,
      // Older photos have no thumbnail yet: use the photo itself only if it's small enough.
      thumb: x.photoThumb || small(x.photo, 300 * 1024),
      likeCount: (x.likes || []).length,
      addedAt: x.addedAt || null,
    }))
    .sort((a, b) => (!!b.thumb - !!a.thumb) || (b.likeCount - a.likeCount) || ((b.addedAt || 0) - (a.addedAt || 0)))
    .slice(0, DISCOVER_SERVICES);
  const hasWork = work.some((w) => w.thumb);
  // Quiet ranking signals: used for ORDER only, never shown or sent.
  const score = (s.verified ? 3 : 0) + (hasWork ? 3 : 0)
    + Math.min(s.groupPoints || 0, 100) / 20 + Math.min(weekVisits, 50) / 10;
  return {
    _score: score,
    card: {
      _id: s._id,
      salonName: s.salonName,
      name: s.name,
      category: s.category,
      area: s.area,
      bio: s.bio ? String(s.bio).slice(0, 200) : null,
      verified: !!s.verified,
      country: countryOf(s),
      currency: s.currency || COUNTRIES[countryOf(s)].currency,
      workModes: s.workModes || [],
      availability: s.availability,
      location: s.location && s.location.lat != null ? { lat: s.location.lat, lng: s.location.lng } : null,
      profilePhoto: small(s.profilePhoto, 150 * 1024),
      popularThisWeek: weekVisits >= 3, // a yes/no, not the raw count
      work,
    },
  };
}

module.exports = { discoverCard, DISCOVER_SHOPS, DISCOVER_SERVICES };
