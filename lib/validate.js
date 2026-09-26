// Checks for everything a professional can type or upload about their shop.
// Each checker returns { ok: true, value } or { ok: false, error }.

function text(raw, { label, min = 0, max }) {
  if (raw === null || raw === undefined) raw = '';
  if (typeof raw !== 'string') return { ok: false, error: `${label} must be text.` };
  const value = raw.replace(/\s+/g, ' ').trim();
  if (value.length < min) return { ok: false, error: min > 1 ? `${label} needs at least ${min} characters.` : `${label} is required.` };
  if (value.length > max) return { ok: false, error: `${label} can be at most ${max} characters.` };
  return { ok: true, value };
}

// Longer text keeps its line breaks (a bio or description with paragraphs).
function longText(raw, { label, max }) {
  if (raw === null || raw === undefined) raw = '';
  if (typeof raw !== 'string') return { ok: false, error: `${label} must be text.` };
  const value = raw.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (value.length > max) return { ok: false, error: `${label} can be at most ${max} characters.` };
  return { ok: true, value };
}

function price(raw) {
  const n = typeof raw === 'string' ? Number(raw.trim()) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) return { ok: false, error: 'Price must be a number.' };
  if (n < 0) return { ok: false, error: 'Price cannot be negative.' };
  if (n > 100000) return { ok: false, error: 'That price looks too high. Please check it.' };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

// Photos must be images uploaded through Sheeba (data URLs). Web addresses
// are refused on purpose: a photo pointing at someone else's server would
// quietly report every customer who views the shop to that server.
// Empty string / null means "remove the photo".
const PHOTO_CAP = {
  service: 300 * 1024, // the app resizes work photos to ~150 KB, so this is generous
  profile: 500 * 1024, // profile and cover photos
  thumb: 60 * 1024,    // small Discover versions of work photos
};
function photo(raw, kind = 'service') {
  if (raw === null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(raw)) {
    return { ok: false, error: 'Photos must be uploaded from your phone or computer (JPEG, PNG or WebP).' };
  }
  if (raw.length > PHOTO_CAP[kind]) return { ok: false, error: 'That photo is too large. Please try a smaller one.' };
  return { ok: true, value: raw };
}

// A shop and all its photos live in ONE database record, which MongoDB caps
// at 16 MB. Worst case with the caps above: 40 services x 300 KB + profile and
// cover 2 x 500 KB + ID photo 1.5 MB = about 14.2 MB. The 14 MB total check
// below is the real safeguard: it refuses a save before the record gets near
// 16 MB, whatever mix of photos a shop has.
const MAX_SERVICES = 40;
const MAX_TOTAL_PHOTO_CHARS = 14 * 1024 * 1024;
const photoLen = (v) => (typeof v === 'string' ? v.length : 0);
function totalPhotoChars(stylist) {
  const len = photoLen;
  return len(stylist.profilePhoto) + len(stylist.coverPhoto) + len(stylist.verifyPhoto)
    + (stylist.styles || []).reduce((sum, s) => sum + len(s.photo) + len(s.photoThumb), 0);
}
const STORAGE_FULL = 'Your shop has reached its photo storage limit. Remove a few older photos first.';

const WORK_MODES = ['SALON', 'HOME', 'MOBILE', 'APPOINTMENT'];
function workModes(raw) {
  if (!Array.isArray(raw)) return { ok: false, error: 'Choose how you work.' };
  const value = [...new Set(raw)];
  if (value.some((m) => !WORK_MODES.includes(m))) return { ok: false, error: 'Unknown way of working.' };
  return { ok: true, value };
}


module.exports = { text, longText, price, photo, workModes, WORK_MODES, MAX_SERVICES, MAX_TOTAL_PHOTO_CHARS, totalPhotoChars, photoLen, STORAGE_FULL, PHOTO_CAP };
