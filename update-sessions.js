const fs = require('fs');
let code = fs.readFileSync('server/routes/users.js', 'utf8');

const sessionsRoutes = `
// GET /api/users/sessions -> list active sessions
router.get('/sessions', auth, (req, res) => {
  const token = req.headers.authorization.split(' ')[1];
  const sessions = db.prepare('SELECT id, device_info, ip_address, last_active, created_at, (token = ?) as is_current FROM sessions WHERE user_id = ? ORDER BY last_active DESC').all(token, req.userId);
  res.json(sessions);
});

// DELETE /api/users/sessions/:id -> terminate session
router.delete('/sessions/:id', auth, (req, res) => {
  const sessionId = parseInt(req.params.id);
  db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(sessionId, req.userId);
  res.json({ success: true });
});

module.exports = { router, auth };
`;

code = code.replace(/module\.exports\s*=\s*\{\s*router,\s*auth\s*\};/, sessionsRoutes);
fs.writeFileSync('server/routes/users.js', code);
console.log('done sess');
