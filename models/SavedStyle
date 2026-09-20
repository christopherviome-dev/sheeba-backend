const mongoose = require('mongoose');

// The customer's own style library — explicitly saved, never auto-created
// from browsing. Kept distinct from a professional's portfolio photo and
// from any future completed-service photo (see the three-way distinction
// in the spec this was built against): this is purely "what the customer
// wants," owned and readable only by that customer.
const SavedStyleSchema = new mongoose.Schema({
  customerId: { type: String, required: true },
  name: { type: String, required: true },
  category: { type: String, default: null },
  photo: { type: String, default: null }, // base64, same pattern as every other photo in Sheeba
  notes: { type: String, default: null },
  // Set only when the customer saves a style FROM a real completed request —
  // never implies the reference photo itself is proof of that service.
  sourceRequestId: { type: String, default: null },
  createdAt: { type: Number, default: () => Date.now() },
});

SavedStyleSchema.index({ customerId: 1, createdAt: -1 });

module.exports = mongoose.models.SavedStyle || mongoose.model('SavedStyle', SavedStyleSchema);
