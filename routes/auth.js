const express = require('express');
const bcrypt = require('bcryptjs');

const router = express.Router();

// POST /auth/login
router.post('/login', async (req, res) => {
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
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// GET /auth/me — check if logged in
router.get('/me', (req, res) => {
  if (req.session.authenticated) {
    res.json({ ok: true, username: req.session.username });
  } else {
    res.status(401).json({ ok: false });
  }
});

module.exports = router;
