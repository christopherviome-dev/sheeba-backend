const mongoose = require('mongoose');
// Simple counters that only go up (e.g. "members": the next member number).
const CounterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
module.exports = mongoose.models.Counter || mongoose.model('Counter', CounterSchema);
