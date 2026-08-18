const mongoose = require('mongoose');

const RequestSchema = new mongoose.Schema({
  stylistId: { type: String, default: null }, // null = open/broadcast request
  styleId: { type: String, default: null },
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

module.exports = mongoose.model('Request', RequestSchema);
