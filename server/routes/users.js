const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_production';

// Avatar upload setup
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `avatar_${req.userId}_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Только изображения (jpg, png, webp, gif)'));
  },
});

// Middleware: require auth
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Нет токена' });
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: 'Недействительный токен' });
  }
}

// GET /api/users/me
router.get('/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, username, public_id, avatar, last_seen FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json(user);
});

// POST /api/users/avatar
router.post('/avatar', auth, (req, res, next) => {
  upload.single('avatar')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Ошибка загрузки' });
    if (!req.file) return res.status(400).json({ error: 'Выберите изображение' });

    // Delete old avatar file
    const old = db.prepare('SELECT avatar FROM users WHERE id = ?').get(req.userId);
    if (old?.avatar) {
      const oldPath = path.join(uploadDir, path.basename(old.avatar));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const avatarUrl = `/uploads/${req.file.filename}`;
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatarUrl, req.userId);
    res.json({ avatar: avatarUrl });
  });
});

// GET /api/users/search?q=ID
router.get('/search', auth, (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const users = db.prepare(
    'SELECT id, username, public_id, avatar, last_seen FROM users WHERE public_id LIKE ? AND id != ? LIMIT 10'
  ).all(`%${q}%`, req.userId);
  res.json(users);
});

// GET /api/users/friends
router.get('/friends', auth, (req, res) => {
  const friends = db.prepare(`
    SELECT u.id, u.username, u.public_id, u.avatar, u.last_seen, f.status
    FROM friends f
    JOIN users u ON (
      CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END = u.id
    )
    WHERE (f.user_id = ? OR f.friend_id = ?)
    AND f.status = 'accepted'
  `).all(req.userId, req.userId, req.userId);
  res.json(friends);
});

// GET /api/users/requests — входящие заявки
router.get('/requests', auth, (req, res) => {
  const requests = db.prepare(`
    SELECT u.id, u.username, u.public_id, u.avatar, f.id as request_id
    FROM friends f
    JOIN users u ON f.user_id = u.id
    WHERE f.friend_id = ? AND f.status = 'pending'
  `).all(req.userId);
  res.json(requests);
});

// POST /api/users/friend-request
router.post('/friend-request', auth, (req, res) => {
  const { public_id } = req.body;
  const target = db.prepare('SELECT id FROM users WHERE public_id = ?').get(public_id);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  if (target.id === req.userId) return res.status(400).json({ error: 'Нельзя добавить себя' });

  const exists = db.prepare(
    'SELECT id FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)'
  ).get(req.userId, target.id, target.id, req.userId);
  if (exists) return res.status(409).json({ error: 'Заявка уже существует или уже друзья' });

  db.prepare('INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)').run(req.userId, target.id, 'pending');
  res.json({ success: true });
});

// POST /api/users/accept-request
router.post('/accept-request', auth, (req, res) => {
  const { request_id } = req.body;
  const request = db.prepare('SELECT * FROM friends WHERE id = ? AND friend_id = ?').get(request_id, req.userId);
  if (!request) return res.status(404).json({ error: 'Заявка не найдена' });
  db.prepare('UPDATE friends SET status = ? WHERE id = ?').run('accepted', request_id);
  res.json({ success: true });
});

// POST /api/users/reject-request
router.post('/reject-request', auth, (req, res) => {
  const { request_id } = req.body;
  db.prepare('DELETE FROM friends WHERE id = ? AND friend_id = ?').run(request_id, req.userId);
  res.json({ success: true });
});

// GET /api/users/messages/:friendId
router.get('/messages/:friendId', auth, (req, res) => {
  const friendId = parseInt(req.params.friendId);
  const messages = db.prepare(`
    SELECT m.id, m.sender_id, m.receiver_id, m.content, m.created_at, m.read_at,
           u.username as sender_username
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    WHERE (m.sender_id = ? AND m.receiver_id = ?)
       OR (m.sender_id = ? AND m.receiver_id = ?)
    ORDER BY m.created_at ASC
    LIMIT 200
  `).all(req.userId, friendId, friendId, req.userId);

  // Mark as read
  db.prepare(
    'UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL'
  ).run(friendId, req.userId);

  res.json(messages);
});

// DELETE /api/users/messages/:messageId
router.delete('/messages/:messageId', auth, (req, res) => {
  const msgId = parseInt(req.params.messageId);
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
  if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });
  if (msg.sender_id !== req.userId) return res.status(403).json({ error: 'Можно удалять только свои сообщения' });
  db.prepare('DELETE FROM messages WHERE id = ?').run(msgId);
  res.json({ success: true, deletedId: msgId, receiverId: msg.receiver_id });
});

module.exports = { router, auth };
