require('dotenv').config();
const express = require('express');
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
