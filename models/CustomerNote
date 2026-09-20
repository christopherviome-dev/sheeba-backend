const mongoose = require('mongoose');

// Strictly a private business note, owned by the stylist who wrote it.
// Never returned by any public or customer-facing endpoint — only the
// authoring stylist can ever read these back.
const CustomerNoteSchema = new mongoose.Schema({
  stylistId: { type: String, required: true },
  customerId: { type: String, required: true },
  note: { type: String, required: true },
  createdAt: { type: Number, default: () => Date.now() },
});

CustomerNoteSchema.index({ stylistId: 1, customerId: 1 });

module.exports = mongoose.models.CustomerNote || mongoose.model('CustomerNote', CustomerNoteSchema);
