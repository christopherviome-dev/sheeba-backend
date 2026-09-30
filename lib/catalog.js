// What Mepluge offers: SERVICES (Hair styling, Barbering, …), each with its own
// STYLES. Barbering is a service in its own right, not a hairstyle.
// Professionals can propose a service that isn't listed; once an admin
// approves it, it joins the catalog for everyone (models/ServiceType.js).
// `for` marks styles aimed at men or women, for the personalised feed.
const S = (key, name, aliases = [], forWho = 'all') => ({ key, name, aliases, for: forWho });

const DEFAULT_SERVICES = [
  { key: 'hair', name: 'Hair styling', styles: [
    // From Christopher's style spreadsheet (photos: Pexels, credited)
    S('afro-braids', 'Afro Braids', ['african braids', 'long braids', 'braided hairstyle'], 'women'),
    S('box-braids', 'Box Braids', ['box plaits', 'individual braids', 'protective braids'], 'women'),
    S('long-box-braids', 'Long Box Braids', ['long braids', 'waist length braids'], 'women'),
    S('cornrows', 'Cornrows', ['cornrow braids', 'canerows', 'straight backs'], 'all'),
    S('braids-with-beads', 'Braids with Wooden Beads', ['beaded braids', 'braids with beads'], 'women'),
    S('intricate-afro-braids', 'Intricate Afro Braids', ['patterned braids', 'design braids'], 'women'),
    S('braiding', 'Braiding', ['braids', 'plaiting', 'braided hair'], 'women'),
    S('dreadlocks', 'Dreadlocks', ['locs', 'dreads'], 'all'),
    S('mens-dreadlocks', "Men's Dreadlocks", ['mens locs', 'male dreads'], 'men'),
    S('short-styled-dreadlocks', 'Short Styled Dreadlocks', ['short locs', 'styled locs'], 'all'),
    S('natural-dreadlocks', 'Natural Dreadlocks', ['freeform locs', 'natural locs'], 'all'),
    S('dreadlocks-with-accessories', 'Dreadlocks with Accessories', ['loc jewellery', 'decorated locs'], 'all'),
    // Common styles without photos yet
    S('knotless-braids', 'Knotless Braids', ['knotless'], 'women'),
    S('twists', 'Twists', ['passion twists', 'senegalese twists'], 'women'),
    S('wigs-weaves', 'Wigs & Weaves', ['wig install', 'weave', 'frontal'], 'women'),
    S('natural-hair-care', 'Natural Hair Care', ['wash and go', 'treatment'], 'all'),
  ] },
  { key: 'barbering', name: 'Barbering', styles: [
    S('fade', 'Fade', ['skin fade', 'taper'], 'men'), S('low-cut', 'Low Cut', ['low haircut'], 'men'),
    S('waves', 'Waves', ['360 waves'], 'men'), S('beard-trim', 'Beard Trim', ['beard', 'beard shape'], 'men'),
    S('shape-up', 'Shape-up', ['line up', 'edge up'], 'men'), S('afro-cut', 'Afro Cut', ['afro shape'], 'all'),
  ] },
  { key: 'makeup', name: 'Makeup', styles: [
    S('bridal-makeup', 'Bridal Makeup', ['wedding makeup'], 'women'), S('natural-glam', 'Natural Glam', ['soft glam'], 'women'),
    S('event-makeup', 'Event Makeup', ['party makeup'], 'women'),
  ] },
  { key: 'nails', name: 'Nails', styles: [
    S('acrylic-nails', 'Acrylic Nails', ['acrylics'], 'women'), S('gel-polish', 'Gel Polish', ['gel nails'], 'women'),
    S('manicure', 'Manicure', [], 'all'), S('pedicure', 'Pedicure', [], 'all'),
  ] },
  { key: 'lashes', name: 'Lashes & brows', styles: [
    S('lash-extensions', 'Lash Extensions', ['lashes'], 'women'), S('brow-shaping', 'Brow Shaping', ['brows', 'eyebrows'], 'all'),
  ] },
  { key: 'skin', name: 'Skin & spa', styles: [
    S('facial', 'Facial', ['facials'], 'all'), S('waxing', 'Waxing', [], 'all'), S('massage', 'Massage', [], 'all'),
  ] },
  // Photographers join as a service of their own (their shoots are their "looks").
  { key: 'photography', name: 'Photography', styles: [
    S('wedding-shoot', 'Wedding Shoot', ['wedding photography', 'wedding photos'], 'all'), S('pre-wedding-shoot', 'Pre-wedding Shoot', ['pre wedding', 'prewedding'], 'all'),
    S('portrait-session', 'Portrait Session', ['portrait', 'portraits', 'headshot', 'headshots'], 'all'), S('graduation-shoot', 'Graduation Shoot', ['graduation photos'], 'all'),
    S('event-coverage', 'Event Coverage', ['event photography', 'party photos'], 'all'), S('studio-shoot', 'Studio Shoot', ['studio photos'], 'all'),
  ] },
];

// Shops created before services existed chose one "category"; map it across.
const LEGACY_CATEGORY = { 'Hair Braiding': 'hair', 'Locs & Twists': 'hair', 'Barbering': 'barbering', 'Makeup': 'makeup', 'Nails & Pedicure': 'nails' };

const slugify = (name) => String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// The full catalog: defaults plus services approved by an admin.
async function getCatalog() {
  let approved = [];
  try { approved = await require('../models/ServiceType').find({ status: 'ACTIVE' }); } catch (e) { /* defaults only */ }
  const extra = approved.filter((a) => !DEFAULT_SERVICES.some((d) => d.key === a.key))
    .map((a) => ({ key: a.key, name: a.name, styles: [], custom: true }));
  return [...DEFAULT_SERVICES, ...extra];
}

// What a shop offers: its chosen services, or (older shops) its category mapped across.
function servicesOf(shop) {
  if (shop && Array.isArray(shop.services) && shop.services.length) return shop.services;
  const k = shop && LEGACY_CATEGORY[shop.category];
  return k ? [k] : [];
}

module.exports = { DEFAULT_SERVICES, LEGACY_CATEGORY, slugify, getCatalog, servicesOf };
