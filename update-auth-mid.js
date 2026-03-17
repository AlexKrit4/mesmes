const fs = require('fs');
let code = fs.readFileSync('server/routes/users.js', 'utf8');

const oldAuth = `function auth(req, res, next) {
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
}`;

const newAuth = `function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Нет токена' });
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // check session validity in DB (if missing, consider invalidated, unless it's from before migration)
    const sessionExists = db.prepare('SELECT id FROM sessions WHERE token = ?').get(token);
    const userHasSessions = db.prepare('SELECT id FROM sessions WHERE user_id = ? LIMIT 1').get(payload.userId);
    
    // If the user has sessions (meaning they logged in after migration) but this token isn't there, it's invalid.
    if (userHasSessions && !sessionExists) {
       return res.status(401).json({ error: 'Сессия завершена' });
    }
    
    // update last_active occasionally (e.g. 10% chance to not hammer DB if high load, but for now 100%)
    if (sessionExists && Math.random() < 0.1) {
       db.prepare('UPDATE sessions SET last_active = CURRENT_TIMESTAMP WHERE id = ?').run(sessionExists.id);
    }

    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: 'Недействительный токен' });
  }
}`;

code = code.replace(oldAuth, newAuth);
fs.writeFileSync('server/routes/users.js', code);
console.log('done auth mid');
