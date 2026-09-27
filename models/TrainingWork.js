const mongoose = require('mongoose');
// A photo of an apprentice's practice work, for their supervisor to review.
// PENDING → APPROVED (optionally shown on the shop's page; never for under-18s)
// or SENT_BACK (with the supervisor's comment).
const TrainingWorkSchema = new mongoose.Schema({
  apprenticeId: { type: String, required: true },
  supervisorId: { type: String, required: true },
  photo: { type: String, required: true },   // checked upload, like service photos
  thumb: { type: String, default: null },    // small version for galleries
  caption: { type: String, default: null },
  skillId: { type: String, default: null },  // the training skill it shows, if any
  status: { type: String, enum: ['PENDING', 'APPROVED', 'SENT_BACK'], default: 'PENDING' },
  supervisorComment: { type: String, default: null },
  showOnShop: { type: Boolean, default: false },
  createdAt: { type: Number, default: () => Date.now() },
  decidedAt: { type: Number, default: null },
});
TrainingWorkSchema.index({ apprenticeId: 1, createdAt: -1 });
TrainingWorkSchema.index({ supervisorId: 1, status: 1, showOnShop: 1 });
module.exports = mongoose.models.TrainingWork || mongoose.model('TrainingWork', TrainingWorkSchema);
