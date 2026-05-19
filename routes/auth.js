const express = require('express');
const router = express.Router();

// POST /auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  const validUser = username === process.env.ADMIN_USERNAME;
  const validPass = password === process.env.ADMIN_PASSWORD;

  if (!validUser || !validPass) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  req.session.authenticated = true;
  req.session.username = username;
  res.json({ ok: true });
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session = null; // cookie-session: set to null to clear
  res.json({ ok: true });
});

// GET /auth/debug — temporary, shows if env vars are loaded (no values exposed)
router.get('/debug', (req, res) => {
  res.json({
    ADMIN_USERNAME_set: !!process.env.ADMIN_USERNAME,
    ADMIN_USERNAME_length: (process.env.ADMIN_USERNAME || '').length,
    ADMIN_PASSWORD_set: !!process.env.ADMIN_PASSWORD,
    ADMIN_PASSWORD_length: (process.env.ADMIN_PASSWORD || '').length,
    SESSION_SECRET_set: !!process.env.SESSION_SECRET,
    NODE_ENV: process.env.NODE_ENV || 'not set',
  });
});

// GET /auth/me
router.get('/me', (req, res) => {
  if (req.session && req.session.authenticated) {
    res.json({ ok: true, username: req.session.username });
  } else {
    res.status(401).json({ ok: false });
  }
});

module.exports = router;
