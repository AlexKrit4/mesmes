const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
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

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function getDeviceInfo(req) {
  return String(req.headers['user-agent'] || 'Unknown device').slice(0, 255);
}

function createSession(userId, token, req) {
  try {
    db.prepare(`
      INSERT INTO sessions (user_id, token, device_info, ip_address, last_active)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(token) DO UPDATE SET
        user_id = excluded.user_id,
        device_info = excluded.device_info,
        ip_address = excluded.ip_address,
        last_active = CURRENT_TIMESTAMP
    `).run(userId, token, getDeviceInfo(req), getClientIp(req));
  } catch (e) {
    console.error('[auth] session create error:', e.message);
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

// Send email via Resend HTTP API (no SMTP needed)
async function sendEmail({ to, subject, text, html }) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY не настроен');

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'MesMes <noreply@mesmes.ru>',
      to: [to],
      subject,
      text,
      html,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    console.error('[resend error]', data);
    throw new Error(data.message || 'Ошибка отправки письма');
  }
  return data;
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
    console.log('[send-code] code saved, sending via Resend...');

    await sendEmail({
      to: email,
      subject: 'Код подтверждения MesMes',
      text: `Ваш код подтверждения: ${code}\n\nКод действует 10 минут.`,
      html: `<div style="font-family:sans-serif;max-width:400px">
        <h2 style="color:#6c5ce7">MesMes</h2>
        <p>Ваш код подтверждения:</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#6c5ce7;margin:20px 0">${code}</div>
        <p style="color:#888">Код действует 10 минут.</p>
      </div>`,
    });
    console.log('[send-code] email sent OK');
    return res.json({ ok: true });
  } catch (e) {
    console.error('[send-code error]', e.message || e);
    return res.status(500).json({ error: e.message || 'Ошибка сервера' });
  }
});

// POST /api/auth/verify-code — check code is valid without consuming it
router.post('/verify-code', (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) {
    return res.status(400).json({ error: 'Email и код обязательны' });
  }
  const now = Math.floor(Date.now() / 1000);
  const verification = db.prepare(
    'SELECT id FROM email_verifications WHERE email = ? AND code = ? AND expires_at > ? AND used = 0 ORDER BY id DESC LIMIT 1'
  ).get(email, code, now);
  if (!verification) {
    return res.status(400).json({ error: 'Неверный или просроченный код' });
  }
  return res.json({ ok: true });
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
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

    // Verify email code (don't mark used yet)
    const now = Math.floor(Date.now() / 1000);
    const verification = db.prepare(
      'SELECT id FROM email_verifications WHERE email = ? AND code = ? AND expires_at > ? AND used = 0 ORDER BY id DESC LIMIT 1'
    ).get(email, code, now);

    if (!verification) {
      return res.status(400).json({ error: 'Неверный или просроченный код подтверждения' });
    }

    const existingId = db.prepare('SELECT id FROM users WHERE public_id = ?').get(public_id);
    if (existingId) {
      return res.status(409).json({ error: 'Этот ID уже занят' });
    }

    const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingEmail) {
      return res.status(409).json({ error: 'Этот email уже зарегистрирован' });
    }

    // Check if email column exists, add it if missing
    try {
      db.exec('ALTER TABLE users ADD COLUMN email TEXT DEFAULT NULL');
    } catch { /* already exists */ }

    const passwordHash = await bcrypt.hash(password, 10);
    const premiumUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const result = db.prepare(
      'INSERT INTO users (username, public_id, password_hash, email, premium_until) VALUES (?, ?, ?, ?, ?)'
    ).run(display_name, public_id, passwordHash, email, premiumUntil);

    // Mark code as used only after successful registration
    db.prepare('UPDATE email_verifications SET used = 1 WHERE id = ?').run(verification.id);

    const token = jwt.sign({ userId: result.lastInsertRowid }, JWT_SECRET, { expiresIn: '30d' });
    createSession(result.lastInsertRowid, token, req);
    return res.json({
      token,
      premium_granted_days: 3,
      user: { id: result.lastInsertRowid, username: display_name, public_id, avatar: null, premium_until: premiumUntil, hide_last_seen: 0 },
    });
  } catch (e) {
    console.error('[register error]', e.message, e.stack);
    return res.status(500).json({ error: e.message || 'Ошибка сервера' });
  }
});

// POST /api/auth/login — вход по public_id или телефону
router.post('/login', async (req, res) => {
  const { public_id, password } = req.body;

  if (!public_id || !password) {
    return res.status(400).json({ error: 'Введите ID и пароль' });
  }

  // Try public_id first, then phone
  let user = db.prepare('SELECT * FROM users WHERE public_id = ?').get(public_id);
  if (!user) {
    user = db.prepare('SELECT * FROM users WHERE phone = ?').get(public_id);
  }
  if (!user) {
    return res.status(401).json({ error: 'Неверный ID или пароль' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Неверный ID или пароль' });
  }

  // Check active ban
  const ban = db.prepare(
    'SELECT id, reason, expires_at, banned_at FROM bans WHERE user_id = ? AND active = 1 ORDER BY id DESC LIMIT 1'
  ).get(user.id);
  if (ban) {
    // If ban has expiry, check if it's still valid
    if (ban.expires_at && new Date(ban.expires_at) < new Date()) {
      // Ban expired — deactivate
      db.prepare('UPDATE bans SET active = 0 WHERE id = ?').run(ban.id);
    } else {
      return res.status(403).json({
        error: 'banned',
        reason: ban.reason,
        expires_at: ban.expires_at,
        banned_at: ban.banned_at,
      });
    }
  }

  db.prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  createSession(user.id, token, req);
  return res.json({
    token,
    user: { id: user.id, username: user.username, public_id: user.public_id, avatar: user.avatar, premium_until: user.premium_until || null, hide_last_seen: user.hide_last_seen || 0 },
  });
});

// POST /api/auth/forgot-password — запрос на восстановление пароля
router.post('/forgot-password', async (req, res) => {
  try {
    const { email, public_id } = req.body || {};
    if (!email || !public_id) {
      return res.status(400).json({ error: 'Email и публичный ID обязательны' });
    }

    const user = db.prepare('SELECT id, public_id, email FROM users WHERE email = ? AND public_id = ?').get(email.trim().toLowerCase(), public_id.trim());
    if (!user) {
      return res.status(404).json({ error: 'Пользователь с такими данными не найден. Проверьте email и ID.' });
    }

    // Rate-limit: не более 1 письма в 60 секунд (защита от спама)
    const recentRequest = db.prepare(
      "SELECT id FROM password_resets WHERE user_id = ? AND used = 0 AND created_at > datetime('now', '-60 seconds') ORDER BY id DESC LIMIT 1"
    ).get(user.id);
    if (recentRequest) {
      return res.status(429).json({ error: 'Подождите 60 секунд перед повторной отправкой' });
    }

    // Rate-limit: не более одного сброса в сутки
    const dayAgo = Math.floor(Date.now() / 1000) - 86400;
    const recentReset = db.prepare(
      'SELECT id FROM password_resets WHERE user_id = ? AND used = 1 AND created_at > datetime(?, \'unixepoch\') ORDER BY id DESC LIMIT 1'
    ).get(user.id, dayAgo);
    if (recentReset) {
      return res.status(429).json({ error: 'Пароль уже менялся сегодня. Попробуйте завтра.' });
    }

    // Токен живёт 1 час
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;

    // Удаляем старые неиспользованные токены для этого пользователя
    db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used = 0').run(user.id);
    db.prepare('INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)').run(user.id, token, expiresAt);

    const APP_URL = process.env.APP_URL || 'https://mesmes.ru';
    const resetLink = `${APP_URL}/reset-password/${token}`;

    await sendEmail({
      to: email.trim().toLowerCase(),
      subject: 'МесМес - Восстановление пароля',
      text: `Здравствуйте, ${user.public_id}. Это письмо поможет вам восстановить пароль. Перейдите по ссылке и вы сможете ввести новый пароль.\n\n${resetLink}\n\nЕсли вы не отправляли запрос на восстановление, просьба проигнорировать письмо.\n\nС наилучшими пожеланиями, МесМес.`,
      html: `<div style="font-family:sans-serif;max-width:480px">
        <h2 style="color:#6c5ce7">МесМес</h2>
        <p>Здравствуйте, <strong>${user.public_id}</strong>.</p>
        <p>Это письмо поможет вам восстановить пароль. Перейдите по ссылке и вы сможете ввести новый пароль.</p>
        <p style="margin:24px 0">
          <a href="${resetLink}" style="background:#6c5ce7;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:16px">Восстановить пароль</a>
        </p>
        <p style="color:#888;font-size:13px">Или скопируйте ссылку: ${resetLink}</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#aaa;font-size:12px">Если вы не отправляли запрос на восстановление, просьба проигнорировать письмо.</p>
        <p style="color:#aaa;font-size:12px">С наилучшими пожеланиями, МесМес.</p>
      </div>`,
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error('[forgot-password error]', e.message || e);
    return res.status(500).json({ error: e.message || 'Ошибка сервера' });
  }
});

// GET /api/auth/reset-password/:token — проверка токена
router.get('/reset-password/:token', (req, res) => {
  const { token } = req.params;
  const now = Math.floor(Date.now() / 1000);
  const reset = db.prepare(
    'SELECT id, user_id FROM password_resets WHERE token = ? AND expires_at > ? AND used = 0 LIMIT 1'
  ).get(token, now);
  if (!reset) {
    return res.status(404).json({ error: 'Ссылка недействительна или устарела' });
  }
  return res.json({ ok: true });
});

// POST /api/auth/reset-password/:token — установить новый пароль
router.post('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body || {};

    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    }

    const now = Math.floor(Date.now() / 1000);
    const reset = db.prepare(
      'SELECT id, user_id FROM password_resets WHERE token = ? AND expires_at > ? AND used = 0 LIMIT 1'
    ).get(token, now);

    if (!reset) {
      return res.status(404).json({ error: 'Ссылка недействительна или устарела' });
    }

    // Rate-limit: не более одного сброса в сутки
    const dayAgo = now - 86400;
    const recentReset = db.prepare(
      'SELECT id FROM password_resets WHERE user_id = ? AND used = 1 AND created_at > datetime(?, \'unixepoch\') ORDER BY id DESC LIMIT 1'
    ).get(reset.user_id, dayAgo);
    if (recentReset) {
      return res.status(429).json({ error: 'Пароль уже менялся сегодня. Попробуйте завтра.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    db.prepare('UPDATE users SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP WHERE id = ?').run(passwordHash, reset.user_id);
    db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(reset.id);

    return res.json({ ok: true });
  } catch (e) {
    console.error('[reset-password error]', e.message || e);
    return res.status(500).json({ error: e.message || 'Ошибка сервера' });
  }
});

module.exports = router;
