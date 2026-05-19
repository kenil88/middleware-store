const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

const COOKIE_NAME = 'mw_token';
const COOKIE_MAX_AGE = 8 * 60 * 60 * 1000; // 8 hours

function cookieOptions() {
  return {
    httpOnly: true,
    maxAge: COOKIE_MAX_AGE,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
}

// POST /auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  const validUser = username === process.env.ADMIN_USERNAME;
  const validPass = password === process.env.ADMIN_PASSWORD;

  if (!validUser || !validPass) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = jwt.sign(
    { username },
    process.env.SESSION_SECRET || 'fallback-secret',
    { expiresIn: '8h' }
  );

  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.json({ ok: true });
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

// GET /auth/me
router.get('/me', (req, res) => {
  if (req.admin) {
    res.json({ ok: true, username: req.admin.username });
  } else {
    res.status(401).json({ ok: false });
  }
});

// GET /auth/debug — temporary
router.get('/debug', (req, res) => {
  res.json({
    ADMIN_USERNAME_set: !!process.env.ADMIN_USERNAME,
    ADMIN_PASSWORD_set: !!process.env.ADMIN_PASSWORD,
    SESSION_SECRET_set: !!process.env.SESSION_SECRET,
    NODE_ENV: process.env.NODE_ENV || 'not set',
    cookie_received: !!req.cookies?.mw_token,
    admin_verified: !!req.admin,
  });
});

module.exports = router;
