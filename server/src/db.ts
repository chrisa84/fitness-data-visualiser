import Database from 'better-sqlite3';

/**
 * Opens the Garmin-Sync database strictly read-only. Garmin-Sync is the sole
 * writer; this app must never hold a write lock on its database.
 */
export function openDb(path: string): Database.Database {
  return new Database(path, { readonly: true, fileMustExist: true });
}

/**
 * Opens (creating if needed) the visualiser's own writable database and ensures
 * the events schema exists. This is separate from the Garmin-Sync database so
 * that mirror stays read-only.
 */
export function openEventsDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS event (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      date       TEXT NOT NULL,
      end_date   TEXT,
      type       TEXT NOT NULL,
      label      TEXT NOT NULL,
      notes      TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_event_date ON event(date);

    CREATE TABLE IF NOT EXISTS chat_conversation (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_message (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role            TEXT NOT NULL,
      content         TEXT NOT NULL,
      tool_calls      TEXT,
      created_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_message_conv ON chat_message(conversation_id);
  `);
  return db;
}
