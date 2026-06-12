import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const db = new DatabaseSync(join(__dirname, 'data.db'))

db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    phone             TEXT    UNIQUE NOT NULL,
    name              TEXT,
    mode              TEXT    NOT NULL DEFAULT 'ai'
                              CHECK(mode IN ('ai', 'human')),
    last_message      TEXT,
    last_message_at   TEXT    DEFAULT (datetime('now')),
    created_at        TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id   INTEGER NOT NULL,
    content           TEXT    NOT NULL,
    direction         TEXT    NOT NULL CHECK(direction IN ('incoming', 'outgoing')),
    timestamp         TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_conv_phone    ON conversations(phone);
  CREATE INDEX IF NOT EXISTS idx_conv_updated  ON conversations(last_message_at DESC);
`)

const stmts = {
  upsertConv:  db.prepare(`INSERT INTO conversations (phone, name) VALUES (?, ?) ON CONFLICT(phone) DO NOTHING`),
  updateName:  db.prepare(`UPDATE conversations SET name = ? WHERE phone = ? AND (name IS NULL OR name = phone)`),
  getConv:     db.prepare(`SELECT * FROM conversations WHERE phone = ?`),
  insertMsg:   db.prepare(`INSERT INTO messages (conversation_id, content, direction) VALUES (?, ?, ?)`),
  updateLast:  db.prepare(`UPDATE conversations SET last_message = ?, last_message_at = datetime('now') WHERE id = ?`),
  allConvs:    db.prepare(`SELECT * FROM conversations ORDER BY last_message_at DESC`),
  getMsgs:     db.prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC LIMIT ?`),
  setMode:     db.prepare(`UPDATE conversations SET mode = ? WHERE phone = ?`),
  getMode:     db.prepare(`SELECT mode FROM conversations WHERE phone = ?`),
}

function getOrCreate(phone, name) {
  stmts.upsertConv.run(phone, name || phone)
  if (name && name !== phone) stmts.updateName.run(name, phone)
  return stmts.getConv.get(phone)
}

export function saveMessage(phone, content, direction, name) {
  const conv = getOrCreate(phone, name)
  stmts.insertMsg.run(conv.id, content, direction)
  stmts.updateLast.run(content, conv.id)
  return conv
}

export function getConversations() {
  return stmts.allConvs.all()
}

export function getMessages(phone, limit = 50) {
  const conv = stmts.getConv.get(phone)
  if (!conv) return []
  return stmts.getMsgs.all(conv.id, limit)
}

export function getMode(phone) {
  return stmts.getMode.get(phone)?.mode ?? 'ai'
}

export function setMode(phone, mode) {
  stmts.setMode.run(mode, phone)
}
