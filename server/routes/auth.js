const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');
const otplib = require('otplib');
const QRCode = require('qrcode');
const { auth } = require('./users');

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

function normalizeTwoFACode(code) {
  return String(code || '').replace(/\s+/g, '').replace(/-/g, '').trim();
}

function verifyTwoFACode(secret, code) {
  const result = otplib.verifySync({ token: code, secret, afterTimeStep: 1 });
  if (typeof result === 'boolean') return result;
  return !!result?.valid;
}

function getActiveBan(userId) {
  const ban = db.prepare(
    'SELECT id, reason, expires_at, banned_at FROM bans WHERE user_id = ? AND active = 1 ORDER BY id DESC LIMIT 1'
  ).get(userId);

  if (!ban) return null;

  if (ban.expires_at && new Date(ban.expires_at) < new Date()) {
    db.prepare('UPDATE bans SET active = 0 WHERE id = ?').run(ban.id);
    return null;
  }

  return ban;
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
  const ban = getActiveBan(user.id);
  if (ban) {
    return res.status(403).json({
      error: 'banned',
      reason: ban.reason,
      expires_at: ban.expires_at,
      banned_at: ban.banned_at,
    });
  }

  // Optional 2FA second step
  if (user.twofa_enabled && user.twofa_secret) {
    const twofaToken = jwt.sign(
      { userId: user.id, purpose: 'login-2fa' },
      JWT_SECRET,
      { expiresIn: '10m' }
    );
    return res.json({
      requires_2fa: true,
      twofa_token: twofaToken,
      user: {
        id: user.id,
        username: user.username,
        public_id: user.public_id,
        avatar: user.avatar,
      },
    });
  }

  db.prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  createSession(user.id, token, req);
  return res.json({
    token,
    user: { id: user.id, username: user.username, public_id: user.public_id, avatar: user.avatar, premium_until: user.premium_until || null, hide_last_seen: user.hide_last_seen || 0 },
  });
});

// POST /api/auth/login/2fa — finalize login with TOTP code
router.post('/login/2fa', (req, res) => {
  const { twofa_token, code } = req.body || {};
  const normalizedCode = normalizeTwoFACode(code);

  if (!twofa_token || !normalizedCode) {
    return res.status(400).json({ error: 'Токен и код 2FA обязательны' });
  }

  if (!/^\d{6}$/.test(normalizedCode)) {
    return res.status(400).json({ error: 'Код 2FA должен состоять из 6 цифр' });
  }

  let payload;
  try {
    payload = jwt.verify(twofa_token, JWT_SECRET);
  } catch {
    return res.status(400).json({ error: 'Срок действия шага 2FA истёк. Войдите заново.' });
  }

  if (!payload?.userId || payload?.purpose !== 'login-2fa') {
    return res.status(400).json({ error: 'Некорректный токен 2FA' });
  }

  const user = db.prepare(
    'SELECT id, username, public_id, avatar, premium_until, hide_last_seen, twofa_enabled, twofa_secret FROM users WHERE id = ?'
  ).get(payload.userId);
  if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
  if (!user.twofa_enabled || !user.twofa_secret) {
    return res.status(400).json({ error: '2FA не включена для этого аккаунта' });
  }

  const validCode = verifyTwoFACode(user.twofa_secret, normalizedCode);
  if (!validCode) {
    return res.status(400).json({ error: 'Неверный код 2FA' });
  }

  const ban = getActiveBan(user.id);
  if (ban) {
    return res.status(403).json({
      error: 'banned',
      reason: ban.reason,
      expires_at: ban.expires_at,
      banned_at: ban.banned_at,
    });
  }

  db.prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  createSession(user.id, token, req);

  return res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      public_id: user.public_id,
      avatar: user.avatar,
      premium_until: user.premium_until || null,
      hide_last_seen: user.hide_last_seen || 0,
    },
  });
});

// GET /api/auth/2fa/status — current 2FA state
router.get('/2fa/status', auth, (req, res) => {
  const row = db.prepare('SELECT twofa_enabled FROM users WHERE id = ?').get(req.userId);
  if (!row) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ enabled: !!row.twofa_enabled });
});

// POST /api/auth/2fa/setup — generate new TOTP secret + QR for account
router.post('/2fa/setup', auth, async (req, res) => {
  const user = db.prepare('SELECT public_id, twofa_enabled FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.twofa_enabled) return res.status(409).json({ error: '2FA уже подключена' });

  const secret = otplib.generateSecret();
  const otpauthUrl = otplib.generateURI({
    strategy: 'totp',
    issuer: 'MesMes',
    label: user.public_id,
    secret,
    period: 30,
    digits: 6,
  });

  try {
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 220, margin: 1 });
    db.prepare('UPDATE users SET twofa_temp_secret = ? WHERE id = ?').run(secret, req.userId);
    res.json({ secret, otpauth_url: otpauthUrl, qr_data_url: qrDataUrl });
  } catch (e) {
    console.error('[2fa/setup error]', e.message);
    res.status(500).json({ error: 'Не удалось сгенерировать QR-код' });
  }
});

// POST /api/auth/2fa/enable — verify code and enable 2FA
router.post('/2fa/enable', auth, (req, res) => {
  const normalizedCode = normalizeTwoFACode(req.body?.code);
  if (!/^\d{6}$/.test(normalizedCode)) {
    return res.status(400).json({ error: 'Введите корректный 6-значный код' });
  }

  const user = db.prepare('SELECT twofa_enabled, twofa_temp_secret FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.twofa_enabled) return res.status(409).json({ error: '2FA уже подключена' });
  if (!user.twofa_temp_secret) {
    return res.status(400).json({ error: 'Сначала начните подключение 2FA' });
  }

  const validCode = verifyTwoFACode(user.twofa_temp_secret, normalizedCode);
  if (!validCode) return res.status(400).json({ error: 'Неверный код подтверждения' });

  db.prepare('UPDATE users SET twofa_enabled = 1, twofa_secret = ?, twofa_temp_secret = NULL WHERE id = ?')
    .run(user.twofa_temp_secret, req.userId);

  res.json({ success: true, enabled: true });
});

// POST /api/auth/2fa/disable — disable 2FA with password + TOTP code
router.post('/2fa/disable', auth, async (req, res) => {
  const normalizedCode = normalizeTwoFACode(req.body?.code);
  const password = String(req.body?.password || '');

  if (!password || !/^\d{6}$/.test(normalizedCode)) {
    return res.status(400).json({ error: 'Введите пароль и корректный 6-значный код' });
  }

  const user = db.prepare('SELECT password_hash, twofa_enabled, twofa_secret FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (!user.twofa_enabled || !user.twofa_secret) {
    return res.status(400).json({ error: '2FA уже отключена' });
  }

  const passwordValid = await bcrypt.compare(password, user.password_hash);
  if (!passwordValid) return res.status(400).json({ error: 'Неверный пароль' });

  const validCode = verifyTwoFACode(user.twofa_secret, normalizedCode);
  if (!validCode) return res.status(400).json({ error: 'Неверный код 2FA' });

  db.prepare('UPDATE users SET twofa_enabled = 0, twofa_secret = NULL, twofa_temp_secret = NULL WHERE id = ?')
    .run(req.userId);

  res.json({ success: true, enabled: false });
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

// POST /api/auth/google — handle Google OAuth token
router.post('/google', async (req, res) => {
  try {
    // Ensure google_id column exists
    try {
      db.exec(`ALTER TABLE users ADD COLUMN google_id TEXT DEFAULT NULL`);
    } catch (e) {
      if (!e.message?.includes('duplicate column') && !e.message?.includes('already exists')) {
        console.warn('[google auth] google_id migration skipped:', e.message?.slice(0, 100));
      }
    }

    const { token: idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ error: 'Google token обязателен' });
    }

    // Verify Google token using google-auth-library
    const { OAuth2Client } = require('google-auth-library');
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const client = new OAuth2Client(GOOGLE_CLIENT_ID);

    let ticket;
    try {
      ticket = await client.verifyIdToken({
        idToken,
        audience: GOOGLE_CLIENT_ID,
      });
    } catch (e) {
      console.error('[google auth] token verification failed:', e.message);
      return res.status(400).json({ error: 'Неверный Google token' });
    }

    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name || payload.email.split('@')[0];

    console.log('[google auth] verified:', { googleId, email, name });

    // Check if user with this google_id exists
    let user;
    try {
      user = db.prepare('SELECT id, username, public_id, email FROM users WHERE google_id = ?').get(googleId);
    } catch (e) {
      // google_id column might not exist yet - try to add it
      if (e.message && e.message.includes('no such column')) {
        console.warn('[google auth] google_id column missing, attempting migration...');
        try {
          db.exec(`ALTER TABLE users ADD COLUMN google_id TEXT DEFAULT NULL`);
          console.log('[google auth] migration successful');
          user = null; // Column just created, no user yet
        } catch (migrateErr) {
          console.error('[google auth] migration failed:', migrateErr.message);
          user = null; // Proceed as new user if migration fails
        }
      } else {
        throw e;
      }
    }
    
    if (user) {
      // User exists → login
      console.log('[google auth] found existing user:', user.id);
      const authToken = jwt.sign(
        { userId: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: '30d' }
      );
      createSession(user.id, authToken, req);
      return res.json({
        ok: true,
        token: authToken,
        user: {
          id: user.id,
          username: user.username,
          public_id: user.public_id,
          email: user.email,
        },
      });
    }

    // Check if user with this email exists (not linked to Google yet)
    user = db.prepare('SELECT id, username, public_id, email, password_hash FROM users WHERE email = ?').get(email);
    
    if (user && user.password_hash) {
      // User with password exists → return "link required" response
      // User needs to create username if not set, then we'll link Google to existing account
      return res.json({
        ok: true,
        new_user: false,
        email,
        user: {
          id: user.id,
          username: user.username,
          public_id: user.public_id,
        },
        action: 'link_google_to_existing',
        message: 'Найден аккаунт с этой почтой. Войди с паролем, чтобы привязать Google.',
      });
    }

    // New user → return email, ask for username + password
    return res.json({
      ok: true,
      new_user: true,
      email,
      name,
      googleId,
      action: 'complete_registration',
      message: 'Создайте username и пароль для завершения регистрации',
    });
  } catch (e) {
    console.error('[google auth error]', e.message || e);
    return res.status(500).json({ error: e.message || 'Ошибка сервера' });
  }
});

// POST /api/auth/google/complete — complete registration after Google OAuth
router.post('/google/complete', async (req, res) => {
  try {
    const { email, googleId, public_id, password, display_name } = req.body;
    
    if (!email || !googleId || !public_id || !password) {
      return res.status(400).json({ error: 'Все поля обязательны' });
    }

    // Validate public_id
    if (public_id.length < 3 || public_id.length > 30) {
      return res.status(400).json({ error: 'Username должен быть 3-30 символов' });
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(public_id)) {
      return res.status(400).json({ error: 'Username может содержать только буквы, цифры, . - и _' });
    }

    // Check if public_id is already taken
    const existing = db.prepare('SELECT id FROM users WHERE public_id = ?').get(public_id);
    if (existing) {
      return res.status(400).json({ error: 'Этот username уже занят' });
    }

    // Check if google_id is already used (shouldn't happen, but just in case)
    // Check if this google_id is already used
    let googleUser;
    try {
      googleUser = db.prepare('SELECT id FROM users WHERE google_id = ? AND google_id IS NOT NULL').get(googleId);
      if (googleUser) {
        return res.status(400).json({ error: 'Этот Google аккаунт уже привязан' });
      }
    } catch (e) {
      // Column doesn't exist yet, that's fine
    }

    const passwordHash = await bcrypt.hash(password, 10);
    
    db.prepare(`
      INSERT INTO users (username, public_id, password_hash, email, google_id, created_at, last_seen)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      display_name || public_id,
      public_id,
      passwordHash,
      email,
      googleId
    );

    const user = db.prepare('SELECT id, username, public_id FROM users WHERE google_id = ?').get(googleId);
    const authToken = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    createSession(user.id, authToken, req);

    return res.json({
      ok: true,
      token: authToken,
      user: {
        id: user.id,
        username: user.username,
        public_id: user.public_id,
        email,
      },
    });
  } catch (e) {
    console.error('[google/complete error]', e.message || e);
    return res.status(500).json({ error: e.message || 'Ошибка сервера' });
  }
});

module.exports = router;
