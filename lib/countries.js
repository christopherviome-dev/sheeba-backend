// Every country Sheeba supports, in ONE place. Adding a country means adding
// an entry here (and its twin in the app's lib/countries.js), nothing else.
//  - currency: what shops there price in (fixed per shop once set)
//  - dial / trunk / nsnLength: phone formats, e.g. Ghana 024 123 4567 is
//    trunk "0" + 9 digits, internationally 233 24 123 4567
//  - distance: km or mi
//  - idDocuments: which identity documents can be verified there
const COUNTRIES = {
  GH: { name: 'Ghana', currency: 'GHS', dial: '233', trunk: '0', nsnLength: 9, distance: 'km',
    idDocuments: [['GHANA_CARD', 'Ghana Card']] },
  GB: { name: 'United Kingdom', currency: 'GBP', dial: '44', trunk: '0', nsnLength: 10, distance: 'mi',
    idDocuments: [['PASSPORT', 'Passport'], ['DRIVING_LICENCE', 'Driving licence'], ['BRP', 'Biometric residence permit']] },
};
const DEFAULT_COUNTRY = 'GH';
const WORLD = require('./worldCountries'); // every country: [name, dialling code, currency]

// Countries without a detailed setup get general support: their own currency
// and dialling code, and the ID documents accepted almost everywhere.
const GENERIC_ID = [['PASSPORT', 'Passport'], ['NATIONAL_ID', 'National ID card'], ['DRIVING_LICENCE', 'Driving licence']];
const MILES = new Set(['GB', 'US', 'LR', 'MM']); // countries that measure road distance in miles
function getCountry(code) {
  if (COUNTRIES[code]) return COUNTRIES[code];
  const w = WORLD[code];
  if (!w) return null;
  return { name: w[0], dial: w[1], currency: w[2], trunk: null, nsnLength: null, distance: MILES.has(code) ? 'mi' : 'km', idDocuments: GENERIC_ID, generic: true };
}
const countryOf = (doc) => (doc && WORLD[doc.country] ? doc.country : DEFAULT_COUNTRY); // older accounts = Ghana

function checkCountry(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: DEFAULT_COUNTRY };
  const c = String(raw).toUpperCase();
  return WORLD[c] ? { ok: true, value: c } : { ok: false, error: 'Please choose a valid country.' };
}

const ID_TYPES = ['GHANA_CARD', 'PASSPORT', 'DRIVING_LICENCE', 'BRP', 'NATIONAL_ID'];

module.exports = { COUNTRIES, WORLD, DEFAULT_COUNTRY, getCountry, countryOf, checkCountry, ID_TYPES };
