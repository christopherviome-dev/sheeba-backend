const mongoose = require('mongoose');
// A field trip: a day out signing shops up in person (e.g. "Kasoa, Saturday").
const FieldTripSchema = new mongoose.Schema({
  name: { type: String, required: true },
  area: { type: String, default: null },
  region: { type: String, default: null },
  country: { type: String, default: 'GH' },
  notes: { type: String, default: null },
  createdBy: { type: String, required: true },
  createdByName: { type: String, default: null },
  startedAt: { type: Number, default: () => Date.now() },
  endedAt: { type: Number, default: null },
});
module.exports = mongoose.models.FieldTrip || mongoose.model('FieldTrip', FieldTripSchema);
