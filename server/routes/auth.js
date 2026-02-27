const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const db = require('../database');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_production';
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || '';

// --- helpers ---
async function verifyTurnstile(token) {
  if (!TURNSTILE_SECRET) return true; // skip in dev if not configured
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: TURNSTILE_SECRET, response: token }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await resp.json();
    console.log('[turnstile result]', data);
    return data.success === true;
  } catch (e) {
    console.error('[turnstile error]', e.message);
    return false;
  }
}

// Diagnostic: check env vars are set (temporary — remove later)
router.get('/check-env', (req, res) => {
  res.json({
    smtp_user: !!process.env.SMTP_USER,
    smtp_pass: !!process.env.SMTP_PASS,
    turnstile_secret: !!process.env.TURNSTILE_SECRET,
    smtp_user_preview: process.env.SMTP_USER ? process.env.SMTP_USER.slice(0, 4) + '***' : 'NOT SET',
    node_version: process.version,
  });
});

function getMailTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

// POST /api/auth/send-code
router.post('/send-code', async (req, res) => {
  try {
    const { email, turnstile_token } = req.body || {};
    if (!email || !turnstile_token) {
      return res.status(400).json({ error: 'Email и captcha обязательны' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Неверный формат email' });
    }

    console.log('[send-code] start, email:', email);

    const captchaOk = await verifyTurnstile(turnstile_token);
    console.log('[send-code] turnstile result:', captchaOk);
    if (!captchaOk) {
      return res.status(400).json({ error: 'Капча не пройдена. Попробуйте ещё раз.' });
    }

    // Rate-limit: not more than 1 code per 60 sec for this email
    const recent = db.prepare(
      'SELECT id FROM email_verifications WHERE email = ? AND created_at > (unixepoch() - 60) ORDER BY id DESC LIMIT 1'
    ).get(email);
    if (recent) {
      return res.status(429).json({ error: 'Подождите 60 секунд перед повторной отправкой' });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 min

    db.prepare(
      'INSERT INTO email_verifications (email, code, expires_at) VALUES (?, ?, ?)'
    ).run(email, code, expiresAt);
    console.log('[send-code] code saved, sending mail...');

    const transporter = getMailTransporter();
    await transporter.sendMail({
      from: `"Mes Mes" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Код подтверждения Mes Mes',
      text: `Ваш код подтверждения: ${code}\n\nКод действует 10 минут.`,
      html: `<div style="font-family:sans-serif;max-width:400px">
        <h2 style="color:#6c5ce7">Mes Mes</h2>
        <p>Ваш код подтверждения:</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#6c5ce7;margin:20px 0">${code}</div>
        <p style="color:#888">Код действует 10 минут.</p>
      </div>`,
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[send-code error]', e.message || e);
    return res.status(500).json({ error: e.message || 'Ошибка сервера' });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { display_name, public_id, password, email, code } = req.body;

  if (!display_name || !public_id || !password || !email || !code) {
    return res.status(400).json({ error: 'Все поля обязательны' });
  }

  if (display_name.length < 1 || display_name.length > 40) {
    return res.status(400).json({ error: 'Имя от 1 до 40 символов' });
  }

  if (!/^[a-zA-Z0-9_]{3,30}$/.test(public_id)) {
    return res.status(400).json({ error: 'ID: только буквы, цифры и _, от 3 до 30 символов' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  }

  // Verify email code
  const now = Math.floor(Date.now() / 1000);
  const verification = db.prepare(
    'SELECT id FROM email_verifications WHERE email = ? AND code = ? AND expires_at > ? AND used = 0 ORDER BY id DESC LIMIT 1'
  ).get(email, code, now);

  if (!verification) {
    return res.status(400).json({ error: 'Неверный или просроченный код подтверждения' });
  }

  // Mark code as used
  db.prepare('UPDATE email_verifications SET used = 1 WHERE id = ?').run(verification.id);

  const existingUser = db.prepare('SELECT id FROM users WHERE public_id = ?').get(public_id);
  if (existingUser) {
    return res.status(409).json({ error: 'Этот ID уже занят' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const result = db.prepare(
      'INSERT INTO users (username, public_id, password_hash, email) VALUES (?, ?, ?, ?)'
    ).run(display_name, public_id, passwordHash, email);

    const token = jwt.sign({ userId: result.lastInsertRowid }, JWT_SECRET, { expiresIn: '30d' });
    return res.json({
      token,
      user: { id: result.lastInsertRowid, username: display_name, public_id, avatar: null },
    });
  } catch (e) {
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/auth/login — вход ТОЛЬКО по public_id
router.post('/login', async (req, res) => {
  const { public_id, password } = req.body;

  if (!public_id || !password) {
    return res.status(400).json({ error: 'Введите ID и пароль' });
  }

  const user = db.prepare('SELECT * FROM users WHERE public_id = ?').get(public_id);
  if (!user) {
    return res.status(401).json({ error: 'Неверный ID или пароль' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Неверный ID или пароль' });
  }

  db.prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  return res.json({
    token,
    user: { id: user.id, username: user.username, public_id: user.public_id, avatar: user.avatar },
  });
});

module.exports = router;
