require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const stylistRoutes = require('./routes/stylists');
const requestRoutes = require('./routes/requests');
const reportRoutes = require('./routes/reports');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // generous limit so photo uploads (base64) go through

app.get('/', (req, res) => res.json({ status: 'Sheeba API is running' }));

app.use('/api/auth', authRoutes);
app.use('/api/stylists', stylistRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/reports', reportRoutes);

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
