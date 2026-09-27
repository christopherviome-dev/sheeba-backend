const mongoose = require('mongoose');
// A service proposed by a professional that isn't in the default catalog
// (lib/catalog.js). PENDING until an admin decides; ACTIVE ones appear in the
// catalog for everyone.
const ServiceTypeSchema = new mongoose.Schema({
  key: { type: String, required: true },   // slug of the name, e.g. "henna-art"
  name: { type: String, required: true },
  status: { type: String, enum: ['PENDING', 'ACTIVE', 'REJECTED'], default: 'PENDING' },
  proposedBy: { type: String, default: null },
  decidedAt: { type: Number, default: null },
  decidedBy: { type: String, default: null },
  rejectReason: { type: String, default: null },
  createdAt: { type: Number, default: () => Date.now() },
});
ServiceTypeSchema.index({ key: 1, status: 1 });
module.exports = mongoose.models.ServiceType || mongoose.model('ServiceType', ServiceTypeSchema);
