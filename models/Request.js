const mongoose = require('mongoose');

const RequestSchema = new mongoose.Schema({
  stylistId: { type: String, default: null }, // null = open/broadcast request
  styleId: { type: String, default: null },
  // Snapshots, captured once at creation — never re-read from the live style
  // later. A price/duration change on the style tomorrow must not silently
  // rewrite what this request actually said at the time.
  serviceNameSnapshot: { type: String, default: null },
  priceSnapshot: { type: Number, default: null },
  durationSnapshot: { type: String, default: null },
  currencySnapshot: { type: String, default: 'GHS' }, // captured at creation — never recalculated later
  clientId: String,
  clientName: String,
  clientPhone: String,
  date: String,
  note: String,
  meet: String, // 'provider' | 'midway' | 'client'
  emergency: String,
  budget: String,
  area: String,
  status: { type: String, default: 'pending' }, // pending | accepted | declined | completed | open
  rating: { type: Number, default: null },
  createdAt: { type: Number, default: () => Date.now() },
  updatedAt: { type: Number, default: () => Date.now() },
});

module.exports = mongoose.models.Request || mongoose.model('Request', RequestSchema);
