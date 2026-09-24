require('dotenv').config();
const express = require('express');
// Must be required right after express and before any routes: makes Express 4
// pass errors thrown inside async routes to the error handler below, instead
// of crashing the whole server (one bad request used to take Sheeba offline).
require('express-async-errors');
const mongoose = require('mongoose');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const stylistRoutes = require('./routes/stylists');
const requestRoutes = require('./routes/requests');
const reportRoutes = require('./routes/reports');
const customerRoutes = require('./routes/customers');
const messageRoutes = require('./routes/messages');
const notificationRoutes = require('./routes/notifications');
const crmRoutes = require('./routes/crm');
const telegramRoutes = require('./routes/telegram');
const currencyRoutes = require('./routes/currencies');
const paymentRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');

const app = express();
app.use(cors());
// The `verify` callback captures the raw, unparsed body onto req.rawBody —
// needed because Paystack's webhook signature is computed over the exact
// raw bytes sent, and re-serializing the parsed JSON would not reliably
// reproduce byte-for-byte the same string (key order, whitespace).
app.use(express.json({ limit: '10mb', verify: (req, res, buf) => { req.rawBody = buf; } }));

app.get('/', (req, res) => res.json({ status: 'Sheeba API is running' }));

app.use('/api/auth', authRoutes);
app.use('/api/stylists', stylistRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api', messageRoutes);
app.use('/api', notificationRoutes);
app.use('/api/stylists', crmRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/currencies', currencyRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);

// Safety net: any error a route didn't handle becomes a normal error response.
// Internal details are logged for us, never sent to the user.
app.use((err, req, res, next) => {
  console.error('Request error:', req.method, req.path, '-', err.name, err.message);
  if (res.headersSent) return next(err);
  if (err.name === 'CastError') return res.status(404).json({ error: 'Not found.' });
  if (err.name === 'ValidationError') return res.status(400).json({ error: 'Some of the information sent isn\u2019t valid.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That upload is too large.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request was not valid.' });
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// Last resort: log stray async errors instead of letting them kill the server.
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err && err.message ? err.message : err);
});

const PORT = process.env.PORT || 4000;

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    app.listen(PORT, () => console.log(`Sheeba API listening on port ${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
