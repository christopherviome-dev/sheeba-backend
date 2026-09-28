const mongoose = require('mongoose');
// One stop on a field trip: a shop visited in person, where it is, what they
// do, the outcome, and (with their consent) photos of their work and craft.
const FieldVisitSchema = new mongoose.Schema({
  tripId: { type: String, required: true },
  clientKey: { type: String, required: true, unique: true }, // made on the phone: a retry after being offline never duplicates
  lat: { type: Number, default: null },
  lng: { type: Number, default: null },
  placeName: { type: String, required: true },
  area: { type: String, default: null },
  services: { type: [String], default: [] },
  outcome: { type: String, enum: ['SIGNED_UP', 'INTERESTED', 'FOLLOW_UP', 'NOT_INTERESTED'], required: true },
  note: { type: String, default: null },        // what they do, how it's done, where the craft comes from
  contactPhone: { type: String, default: null }, // only if they gave it, for following up
  photos: { type: [String], default: [] },       // up to 4, only with consent
  photoConsent: { type: Boolean, default: false },
  signedUpStylistId: { type: String, default: null }, // their Sheeba account, once linked
  loggedBy: { type: String, required: true },
  at: { type: Number, default: () => Date.now() }, // when the stop happened (from the phone)
});
FieldVisitSchema.index({ tripId: 1, at: 1 });
module.exports = mongoose.models.FieldVisit || mongoose.model('FieldVisit', FieldVisitSchema);
