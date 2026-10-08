const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

const query = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

async function initDb() {
  db.serialize(async () => {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        plan TEXT DEFAULT 'free',
        role TEXT DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS connected_accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        platform_account_id TEXT,
        username TEXT NOT NULL,
        name TEXT,
        profile_picture_url TEXT,
        access_token TEXT,
        token_expires_at DATETIME,
        followers_count INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        media_url TEXT,
        media_id TEXT,
        caption TEXT,
        scheduled_at DATETIME NOT NULL,
        published_at DATETIME,
        status TEXT DEFAULT 'scheduled',
        speedpost_post_id TEXT,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (account_id) REFERENCES connected_accounts(id) ON DELETE CASCADE
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    const admin = await get(`SELECT * FROM users WHERE email = ?`, ['admin@speedpost.com']);
    if (!admin) {
      const hash = await bcrypt.hash('admin123', 10);
      const adminId = 'usr_admin_' + Date.now().toString(36);
      await run(`
        INSERT INTO users (id, name, email, password_hash, plan, role)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [adminId, 'Administrador', 'admin@speedpost.com', hash, 'pro', 'admin']);

      await run(`
        INSERT INTO connected_accounts (
          id, user_id, platform, platform_account_id, username, name, profile_picture_url, followers_count, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        'cmqwqytic2po99xgdlf08vnc1',
        adminId,
        'INSTAGRAM',
        'ig_cenasqueamo',
        '@cenasqueamo._',
        'Cenas Que Amo',
        'https://scontent-lhr6-1.cdninstagram.com/favicon.ico',
        183503,
        1
      ]);
    }
  });
}

initDb();

module.exports = {
  db,
  query,
  run,
  get
};
