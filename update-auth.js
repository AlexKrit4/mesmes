const fs = require('fs');

let code = fs.readFileSync('server/routes/auth.js', 'utf8');

const oldLoginEnd = `  db.prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  return res.json({`;

const newLoginEnd = `  db.prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  
  // Track session
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const ua = req.headers['user-agent'] || 'Unknown Device';
  try {
     db.prepare('INSERT INTO sessions (user_id, token, device_info, ip_address) VALUES (?, ?, ?, ?)').run(user.id, token, ua, ip);
  } catch (e) {
     console.error('Session track error:', e);
  }

  return res.json({`;

code = code.replace(oldLoginEnd, newLoginEnd);
fs.writeFileSync('server/routes/auth.js', code);
console.log('done auth');
