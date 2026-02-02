const path = require('path');
const Database = require('better-sqlite3');

// On Render, use the persistent disk mount path. Locally, use project root.
const DB_DIR = process.env.DB_DIR || path.join(__dirname, '..', '..');
const DB_PATH = path.join(DB_DIR, 'uae.db');

let _db = null;

function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

module.exports = { getDb, DB_PATH };
