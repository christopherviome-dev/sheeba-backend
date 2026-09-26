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
const countryOf = (doc) => (doc && COUNTRIES[doc.country] ? doc.country : DEFAULT_COUNTRY); // older accounts = Ghana

function checkCountry(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: DEFAULT_COUNTRY };
  const c = String(raw).toUpperCase();
  return COUNTRIES[c] ? { ok: true, value: c } : { ok: false, error: 'Sheeba isn\u2019t available in that country yet.' };
}

const ID_TYPES = [...new Set(Object.values(COUNTRIES).flatMap((c) => c.idDocuments.map(([k]) => k)))];

module.exports = { COUNTRIES, DEFAULT_COUNTRY, countryOf, checkCountry, ID_TYPES };
