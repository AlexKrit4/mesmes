const { DatabaseSync } = require('node:sqlite');
const path = require('path');

// На Railway используйте Volume, примонтированный в /data
// Переменная окружения DB_PATH=/data/messenger.db
const dbPath = process.env.DB_PATH || path.join(__dirname, 'messenger.db');
const db = new DatabaseSync(dbPath);

// Enable WAL mode and foreign keys
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    public_id TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    avatar TEXT DEFAULT NULL,
    email TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    friend_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (friend_id) REFERENCES users(id),
    UNIQUE(user_id, friend_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    read_at DATETIME DEFAULT NULL,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id)
  );
`);

module.exports = db;

// Migration: add avatar column if missing (for existing databases)
try {
  db.exec(`ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT NULL`);
} catch (e) {
  // Column already exists — ignore
}

// Migration: push subscriptions table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
} catch (e) {
  // ignore
}

// Migration: add email column to users
try {
  db.exec(`ALTER TABLE users ADD COLUMN email TEXT DEFAULT NULL`);
} catch (e) {
  // ignore
}

// Migration: email verifications table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);
} catch (e) {
  // ignore
}

// Migration: add last_public_id_change to users
try {
  db.exec(`ALTER TABLE users ADD COLUMN last_public_id_change DATETIME DEFAULT NULL`);
} catch (e) {}

// Migration: add edited flag to messages
try {
  db.exec(`ALTER TABLE messages ADD COLUMN edited INTEGER DEFAULT 0`);
} catch (e) {}

// Migration: add soft-delete flags to messages
try {
  db.exec(`ALTER TABLE messages ADD COLUMN deleted_for_sender INTEGER DEFAULT 0`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE messages ADD COLUMN deleted_for_receiver INTEGER DEFAULT 0`);
} catch (e) {}

// Migration: add file_url to messages (for image sharing)
try {
  db.exec(`ALTER TABLE messages ADD COLUMN file_url TEXT DEFAULT NULL`);
} catch (e) {}

// Migration: add reply_to_id to messages (for reply/quote feature)
try {
  db.exec(`ALTER TABLE messages ADD COLUMN reply_to_id INTEGER DEFAULT NULL`);
} catch (e) {}

// Migration: add is_admin to users
try {
  db.exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`);
} catch (e) {}

// Migration: bans table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      banned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME DEFAULT NULL,
      banned_by INTEGER,
      active INTEGER DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (banned_by) REFERENCES users(id)
    )
  `);
} catch (e) {}

// Migration: remove UNIQUE constraint from username (display name should not be unique)
// SQLite doesn't support DROP CONSTRAINT, so we recreate the table
try {

// Migration: sessions table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      device_info TEXT,
      ip_address TEXT,
      last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
} catch (e) {}
  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  // Only migrate if username still has UNIQUE constraint
  if (tableInfo && /username\s+TEXT\s+UNIQUE/i.test(tableInfo.sql)) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        public_id TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        avatar TEXT DEFAULT NULL,
        email TEXT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`
      INSERT INTO users_new (id, username, public_id, password_hash, avatar, email, created_at, last_seen)
      SELECT id, username, public_id, password_hash, avatar, email, created_at, last_seen FROM users
    `);
    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_new RENAME TO users');
    db.exec('PRAGMA foreign_keys = ON');
    console.log('[db] Migration: removed UNIQUE from users.username');
  }
} catch (e) {
  db.exec('PRAGMA foreign_keys = ON');
  console.error('[db] Migration error (username unique):', e.message);
}

// Set admin for alexkrit
try {
  db.prepare("UPDATE users SET is_admin = 1 WHERE public_id = 'alexkrit'").run();
} catch (e) {}

// Migration: channels table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      avatar TEXT DEFAULT NULL,
      owner_id INTEGER NOT NULL,
      invite_code TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    )
  `);
} catch (e) {}

// Migration: channel_members table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(channel_id, user_id)
    )
  `);
} catch (e) {}

// Migration: channel_messages table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      file_url TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id)
    )
  `);
} catch (e) {}

// Migration: add edited column to channel_messages
try {
  db.exec(`ALTER TABLE channel_messages ADD COLUMN edited INTEGER DEFAULT 0`);
} catch (e) {}

// Migration: channel_reactions table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      emoji TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES channel_messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(message_id, user_id)
    )
  `);
} catch (e) {}

// Migration: add phone, bio, last_phone_change to users
try { db.exec(`ALTER TABLE users ADD COLUMN phone TEXT DEFAULT NULL`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN last_phone_change DATETIME DEFAULT NULL`); } catch (e) {}

// Migration: message_reactions table for DMs
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      emoji TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(message_id, user_id)
    )
  `);
} catch (e) {}

// Migration: premium fields on users
try { db.exec(`ALTER TABLE users ADD COLUMN premium_until DATETIME DEFAULT NULL`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN hide_last_seen INTEGER DEFAULT 0`); } catch (e) {}

// Migration: stories table (video stories on profile)
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      video_url TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
} catch (e) {}

// Migration: chat_wallpapers table (per-user chat background)
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_wallpapers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      friend_id INTEGER NOT NULL,
      wallpaper_url TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, friend_id)
    )
  `);
} catch (e) {}

// Migration: password_resets table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
} catch (e) {}

// Migration: password_changed_at — rate-limit (once per day)
try { db.exec(`ALTER TABLE users ADD COLUMN password_changed_at DATETIME DEFAULT NULL`); } catch (e) {}
