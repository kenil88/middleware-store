require('dotenv').config();
const express = require('express');
const path = require('path');
const uploadRouter = require('./routes/upload');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple token auth middleware for all /api routes
app.use('/api', (req, res, next) => {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return next();
  const token = req.headers['x-admin-secret'] || req.query.secret;
  if (token !== secret) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

app.use('/api', uploadRouter);

// Catch-all → admin UI
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Middleware Store running at http://localhost:${PORT}`);
  console.log(`Shopify store: ${process.env.SHOPIFY_STORE_DOMAIN}`);
});
