const mongoose = require('mongoose');

const StyleSchema = new mongoose.Schema({
  id: String,
  name: String,
  price: Number,
  duration: String,
  desc: String,
  photo: String, // base64 data URL — fine at this scale, move to cloud storage later if it grows
  colorTag: String,
  likes: { type: [String], default: [] }, // clientIds
}, { _id: false });

const StylistSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  name: String,
  salonName: String,
  category: String,
  area: String,
  bio: String,
  coverPhoto: String,
  brandColor: String,
  verifyPhoto: String,
  ghanaCardNum: String,
  pendingReview: { type: Boolean, default: false },
  verified: { type: Boolean, default: false },
  color: String,
  styles: { type: [StyleSchema], default: [] },
  followers: { type: [String], default: [] }, // clientIds
  lastActiveAt: { type: Number, default: () => Date.now() },
  isAdmin: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.models.Stylist || mongoose.model('Stylist', StylistSchema);
