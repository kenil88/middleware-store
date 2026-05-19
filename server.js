require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const uploadRouter = require('./routes/upload');
const authRouter = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
}));

// Auth routes (public)
app.use('/auth', authRouter);

// Serve login page (public)
app.get('/login', (req, res) => {
  if (req.session.authenticated) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Protect everything else
app.use((req, res, next) => {
  if (req.session.authenticated) return next();
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

app.listen(PORT, () => {
  console.log(`Middleware Store running at http://localhost:${PORT}`);
  console.log(`Shopify store : ${process.env.SHOPIFY_STORE_DOMAIN}`);
  console.log(`Admin user    : ${process.env.ADMIN_USERNAME}`);
});
