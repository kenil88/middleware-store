require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');
const uploadRouter = require('./routes/upload');
const authRouter = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// JWT auth check middleware
app.use((req, res, next) => {
  const token = req.cookies && req.cookies.mw_token;
  if (token) {
    try {
      req.admin = jwt.verify(token, process.env.SESSION_SECRET || 'fallback-secret');
    } catch {
      req.admin = null;
    }
  }
  next();
});

// Auth routes (public)
app.use('/auth', authRouter);

// Serve login page (public)
app.get('/login', (req, res) => {
  if (req.admin) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Protect everything else
app.use((req, res, next) => {
  if (req.admin) return next();
  if (req.path.startsWith('/api')) return res.status(401).json({ error: 'Not authenticated' });
  res.redirect('/login');
});

// Static files (served after auth check)
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', uploadRouter);

// Catch-all → admin UI
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Export for Vercel serverless; listen for local dev
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Running at http://localhost:${PORT}`);
    console.log(`Shopify store : ${process.env.SHOPIFY_STORE_DOMAIN}`);
    console.log(`Admin user    : ${process.env.ADMIN_USERNAME}`);
  });
}

module.exports = app;
