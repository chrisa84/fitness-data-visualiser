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
  `);
  return db;
}
