const mongoose = require('mongoose');
// A Look Reel: 3 to 8 photos of one look from different angles (front, back,
// sides, even how it started), played like a short video. Kept in its own
// record so a shop's photos never outgrow the shop record.
//   key: "service:<shopId>:<serviceId>"  (a professional's work)
//        "look:<requestId>"               (a customer's finished look)
const LookReelSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  kind: { type: String, enum: ['service', 'look'], required: true },
  shopId: { type: String, required: true },
  serviceId: { type: String, default: null },
  requestId: { type: String, default: null },
  customerId: { type: String, default: null },
  frames: { type: [String], default: [] },
  createdBy: { type: String, default: null },
  updatedAt: { type: Number, default: () => Date.now() },
});
module.exports = mongoose.models.LookReel || mongoose.model('LookReel', LookReelSchema);
