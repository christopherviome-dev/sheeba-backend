const mongoose = require('mongoose');
// The last exchange rates fetched (base currency as _id, e.g. "GHS"), kept so a
// restart or a moment without internet still has yesterday's rates.
// Source: ExchangeRate-API open access (exchangerate-api.com), attribution shown in the app.
const FxRateSchema = new mongoose.Schema({
  _id: String,
  rates: { type: mongoose.Schema.Types.Mixed, default: {} },
  fetchedAt: { type: Number, default: 0 },
  sourceUpdatedAt: { type: Number, default: 0 },
});
module.exports = mongoose.models.FxRate || mongoose.model('FxRate', FxRateSchema);
