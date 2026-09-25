// Identity helpers for Ghana Card verification (Layer 1).
//
// What these can and cannot do, stated plainly:
// - They check that a card number is in the published PIN FORMAT. They do
//   NOT check the final checksum character: NIA has not published that
//   formula, so any "checksum validation" would be a guess.
// - They compare the typed legal name with the name the account registered
//   with. That catches obvious inconsistencies, but it is NOT a check
//   against the card itself. Only a human looking at the card photo (Layer 1)
//   or a lookup against NIA's records (Layer 2) can confirm the card's name.

// PIN format per NIA: a 3-letter nationality code (GHA for Ghanaians,
// other codes for non-citizen residents), a system number (8 or 9 digits
// per published guides), and one check character.
const CARD_PATTERN = /^([A-Z]{3})-?(\d{8,9})-?([0-9A-Z])$/;

function normalizeGhanaCard(raw) {
  if (typeof raw !== 'string') return null;
  const compact = raw
    .toUpperCase()
    .replace(/[\u2010-\u2015]/g, '-') // typographic dashes from phone keyboards → plain hyphen
    .replace(/\s+/g, '');
  const m = compact.match(CARD_PATTERN);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// Letters from any alphabet (so names with accents work), plus the
// separators real names use: space, hyphen, apostrophe, full stop.
const NAME_PATTERN = /^[\p{L}][\p{L}'’.\- ]*[\p{L}.]$/u;

function cleanLegalName(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'Enter your full name as it appears on your Ghana Card.' };
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length < 5 || name.length > 100) return { ok: false, error: 'Enter your full name as it appears on your Ghana Card.' };
  if (!NAME_PATTERN.test(name)) return { ok: false, error: 'Use letters only (spaces, hyphens and apostrophes are fine).' };
  if (nameTokens(name).length < 2) return { ok: false, error: 'Enter at least your first name and surname, exactly as on the card.' };
  return { ok: true, name };
}

function nameTokens(name) {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents for comparison only
    .toLowerCase()
    .split(/[\s\-'’.]+/)
    .filter((t) => t.length >= 2);
}

// Compares the account's registration name with the typed legal name.
// Returns a hint for the admin, never an automatic decision.
function compareNames(registrationName, legalName) {
  const reg = nameTokens(registrationName);
  const legal = new Set(nameTokens(legalName));
  if (reg.length === 0 || legal.size === 0) return 'UNKNOWN';
  const shared = reg.filter((t) => legal.has(t)).length;
  if (shared === reg.length) return 'MATCH';
  if (shared > 0) return 'PARTIAL';
  // Short forms: people often register as "Chris" or "Nana Ama" while the
  // card says "Christopher" or "Nana Amankwah". A registration name of 3+
  // letters that starts a legal name counts as a partial match, so the
  // admin is asked to check carefully rather than warned of a mismatch.
  const legalList = [...legal];
  if (reg.some((t) => t.length >= 3 && legalList.some((l) => l !== t && l.startsWith(t)))) return 'PARTIAL';
  return 'DIFFERENT';
}

// Card photo must be a real image data URL, and a sane size.
const MAX_PHOTO_CHARS = 4 * 1024 * 1024; // ~3MB image once decoded
function checkCardPhoto(photo) {
  if (typeof photo !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(photo)) {
    return 'Upload a clear photo of your Ghana Card (JPEG, PNG or WebP).';
  }
  if (photo.length > MAX_PHOTO_CHARS) return 'That photo is too large. Please use a smaller image.';
  return null;
}

module.exports = { normalizeGhanaCard, cleanLegalName, compareNames, nameTokens, checkCardPhoto };
