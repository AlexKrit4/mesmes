const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_production';

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, public_id, password } = req.body;

  if (!username || !public_id || !password) {
    return res.status(400).json({ error: 'Все поля обязательны' });
  }

  if (!/^[a-zA-Z0-9_]{3,30}$/.test(public_id)) {
    return res.status(400).json({ error: 'ID может содержать только буквы, цифры и _, от 3 до 30 символов' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  }

  const existingUser = db.prepare('SELECT id FROM users WHERE username = ? OR public_id = ?').get(username, public_id);
  if (existingUser) {
    return res.status(409).json({ error: 'Имя пользователя или ID уже занято' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const result = db.prepare(
      'INSERT INTO users (username, public_id, password_hash) VALUES (?, ?, ?)'
    ).run(username, public_id, passwordHash);

    const token = jwt.sign({ userId: result.lastInsertRowid }, JWT_SECRET, { expiresIn: '30d' });
    return res.json({ token, user: { id: result.lastInsertRowid, username, public_id } });
  } catch (e) {
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Введите имя и пароль' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ? OR public_id = ?').get(username, username);
  if (!user) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  db.prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  return res.json({ token, user: { id: user.id, username: user.username, public_id: user.public_id } });
});

module.exports = router;
