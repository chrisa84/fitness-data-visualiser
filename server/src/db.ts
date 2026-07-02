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
      context         TEXT,
      created_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_message_conv ON chat_message(conversation_id);

    CREATE TABLE IF NOT EXISTS saved_route (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      name             TEXT NOT NULL,
      waypoints        TEXT NOT NULL,
      snap             INTEGER NOT NULL DEFAULT 1,
      total_distance_m REAL,
      created_at       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_settings (
      id                INTEGER PRIMARY KEY CHECK (id = 1),
      question_model_1  TEXT NOT NULL,
      question_model_2  TEXT NOT NULL,
      question_model_3  TEXT NOT NULL,
      question_selected TEXT NOT NULL,
      plan_model_1      TEXT NOT NULL,
      plan_model_2      TEXT NOT NULL,
      plan_model_3      TEXT NOT NULL,
      plan_selected     TEXT NOT NULL,
      analysis_model_1  TEXT NOT NULL DEFAULT '',
      analysis_model_2  TEXT NOT NULL DEFAULT '',
      analysis_model_3  TEXT NOT NULL DEFAULT '',
      analysis_selected TEXT NOT NULL DEFAULT '',
      updated_at        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS training_plan (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_description       TEXT NOT NULL,
      is_race                INTEGER NOT NULL DEFAULT 0,
      goal_race_distance_m   REAL,
      goal_target_duration_s INTEGER,
      start_date             TEXT NOT NULL,
      end_date               TEXT NOT NULL,
      days_per_week          INTEGER NOT NULL,
      status                 TEXT NOT NULL DEFAULT 'active',
      created_at             TEXT NOT NULL,
      ended_at               TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_training_plan_status ON training_plan(status);

    CREATE TABLE IF NOT EXISTS training_plan_workout (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id                INTEGER NOT NULL,
      date                   TEXT NOT NULL,
      title                  TEXT NOT NULL,
      description            TEXT,
      workout_type           TEXT NOT NULL,
      target_distance_m      REAL,
      target_duration_s      INTEGER,
      target_pace_sec_per_km INTEGER,
      target_pace_min_sec_per_km INTEGER,
      target_pace_max_sec_per_km INTEGER,
      completed_at           TEXT,
      notes                  TEXT,
      created_at             TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_training_plan_workout_plan ON training_plan_workout(plan_id);

    CREATE TABLE IF NOT EXISTS route_geometry (
      activity_id TEXT PRIMARY KEY,
      polyline    TEXT NOT NULL,
      point_count INTEGER NOT NULL,
      start_lat   REAL,
      start_lon   REAL,
      end_lat     REAL,
      end_lon     REAL,
      computed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS route_cluster (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      medoid_activity_id TEXT NOT NULL,
      start_lat          REAL NOT NULL,
      start_lon          REAL NOT NULL,
      distance_m         REAL,
      created_at         TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS route_cluster_member (
      activity_id TEXT PRIMARY KEY,
      cluster_id  INTEGER NOT NULL,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_route_cluster_member_cluster ON route_cluster_member(cluster_id);

    CREATE TABLE IF NOT EXISTS training_plan_revision (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id      INTEGER NOT NULL,
      created_at   TEXT NOT NULL,
      rationale    TEXT NOT NULL,
      changes_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_training_plan_revision_plan ON training_plan_revision(plan_id);
  `);

  // Migration: add chat_message.context to databases created before it existed.
  const messageColumns = db.prepare('PRAGMA table_info(chat_message)').all() as { name: string }[];
  if (!messageColumns.some((c) => c.name === 'context')) {
    db.exec('ALTER TABLE chat_message ADD COLUMN context TEXT');
  }

  // Migration: add training_plan_workout pace-range columns to databases created before they existed.
  const workoutColumns = db.prepare('PRAGMA table_info(training_plan_workout)').all() as { name: string }[];
  if (!workoutColumns.some((c) => c.name === 'target_pace_min_sec_per_km')) {
    db.exec('ALTER TABLE training_plan_workout ADD COLUMN target_pace_min_sec_per_km INTEGER');
  }
  if (!workoutColumns.some((c) => c.name === 'target_pace_max_sec_per_km')) {
    db.exec('ALTER TABLE training_plan_workout ADD COLUMN target_pace_max_sec_per_km INTEGER');
  }

  // Migration: add the activity-analysis model columns to databases created before they existed.
  const aiColumns = db.prepare('PRAGMA table_info(ai_settings)').all() as { name: string }[];
  if (!aiColumns.some((c) => c.name === 'analysis_model_1')) {
    db.exec(`
      ALTER TABLE ai_settings ADD COLUMN analysis_model_1  TEXT NOT NULL DEFAULT '';
      ALTER TABLE ai_settings ADD COLUMN analysis_model_2  TEXT NOT NULL DEFAULT '';
      ALTER TABLE ai_settings ADD COLUMN analysis_model_3  TEXT NOT NULL DEFAULT '';
      ALTER TABLE ai_settings ADD COLUMN analysis_selected TEXT NOT NULL DEFAULT '';
    `);
  }

  // Seed the single ai_settings row with today's defaults on first run.
  const DEFAULT_MODELS = ['deepseek/deepseek-v4-flash', 'google/gemini-3.5-flash', 'deepseek/deepseek-v4-pro'] as const;
  db.prepare(
    `INSERT OR IGNORE INTO ai_settings
       (id, question_model_1, question_model_2, question_model_3, question_selected,
            plan_model_1, plan_model_2, plan_model_3, plan_selected,
            analysis_model_1, analysis_model_2, analysis_model_3, analysis_selected, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    DEFAULT_MODELS[0],
    DEFAULT_MODELS[1],
    DEFAULT_MODELS[2],
    DEFAULT_MODELS[0],
    DEFAULT_MODELS[0],
    DEFAULT_MODELS[1],
    DEFAULT_MODELS[2],
    DEFAULT_MODELS[0],
    DEFAULT_MODELS[0],
    DEFAULT_MODELS[1],
    DEFAULT_MODELS[2],
    DEFAULT_MODELS[0],
    new Date().toISOString(),
  );

  // Backfill the analysis role from question defaults for rows migrated above.
  db.exec(`
    UPDATE ai_settings SET
      analysis_model_1  = question_model_1,
      analysis_model_2  = question_model_2,
      analysis_model_3  = question_model_3,
      analysis_selected = question_selected
    WHERE analysis_model_1 = ''
  `);

  return db;
}
