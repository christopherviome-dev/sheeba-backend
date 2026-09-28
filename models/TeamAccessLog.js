const mongoose = require('mongoose');
// Every time a shop helper opens a customer's chair card, it's recorded here,
// and the shop owner can see it. Knowing it's recorded is itself a deterrent.
const TeamAccessLogSchema = new mongoose.Schema({
  shopId: { type: String, required: true },
  staffId: { type: String, required: true },
  customerId: { type: String, required: true },
  requestId: { type: String, default: null },
  at: { type: Number, default: () => Date.now() },
});
TeamAccessLogSchema.index({ shopId: 1, at: -1 });
module.exports = mongoose.models.TeamAccessLog || mongoose.model('TeamAccessLog', TeamAccessLogSchema);
