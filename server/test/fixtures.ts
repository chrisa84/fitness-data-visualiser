import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface DailySummarySeed {
  date: string;
  resting_hr?: number | null;
  total_steps?: number | null;
  avg_stress_level?: number | null;
  body_battery_highest?: number | null;
  body_battery_lowest?: number | null;
  moderate_intensity_minutes?: number | null;
  vigorous_intensity_minutes?: number | null;
  sleep_score?: number | null;
  total_sleep_seconds?: number | null;
  deep_sleep_seconds?: number | null;
  light_sleep_seconds?: number | null;
  rem_sleep_seconds?: number | null;
  awake_seconds?: number | null;
  hrv_nightly?: number | null;
  hrv_weekly?: number | null;
  hrv_baseline_low?: number | null;
  hrv_baseline_high?: number | null;
  bb_charged?: number | null;
  bb_drained?: number | null;
}

export interface ActivitySeed {
  activity_id: string;
  name?: string | null;
  type?: string | null;
  start_time_local?: string | null;
  distance_m?: number | null;
  duration_s?: number | null;
  avg_hr?: number | null;
  elevation_gain_m?: number | null;
  avg_cadence?: number | null;
  avg_power?: number | null;
  ground_contact_ms?: number | null;
  ground_contact_balance_left?: number | null;
  vertical_oscillation_cm?: number | null;
  vertical_ratio_pct?: number | null;
  stride_length_cm?: number | null;
}

export interface SplitSeed {
  activity_id: string;
  split_index: number;
  split_type?: string | null;
  distance_m?: number | null;
  duration_s?: number | null;
  avg_hr?: number | null;
}

/**
 * Creates a throwaway SQLite file with minimal daily_summary and heart_rate
 * tables. Mirrors production: resting HR lives in heart_rate, not
 * daily_summary.
 */
export function createTestDb(
  rows: DailySummarySeed[],
  activities: ActivitySeed[] = [],
  splits: SplitSeed[] = [],
): string {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-vis-test-'));
  const path = join(dir, 'test.db');
  const db = new Database(path);
  db.exec(`
    CREATE TABLE daily_summary (
      date                       TEXT PRIMARY KEY,
      total_steps                INTEGER,
      avg_stress_level           INTEGER,
      body_battery_highest       INTEGER,
      body_battery_lowest        INTEGER,
      moderate_intensity_minutes INTEGER,
      vigorous_intensity_minutes INTEGER
    );
    CREATE TABLE heart_rate (
      date       TEXT PRIMARY KEY,
      resting_hr INTEGER
    );
    CREATE TABLE sleep (
      date                TEXT PRIMARY KEY,
      sleep_score         INTEGER,
      total_sleep_seconds INTEGER,
      deep_sleep_seconds  INTEGER,
      light_sleep_seconds INTEGER,
      rem_sleep_seconds   INTEGER,
      awake_seconds       INTEGER
    );
    CREATE TABLE hrv (
      date           TEXT PRIMARY KEY,
      last_night_avg INTEGER,
      weekly_avg     INTEGER,
      baseline_low   INTEGER,
      baseline_high  INTEGER
    );
    CREATE TABLE body_battery (
      date    TEXT PRIMARY KEY,
      charged INTEGER,
      drained INTEGER
    );
    CREATE TABLE activity (
      activity_id        TEXT PRIMARY KEY,
      name               TEXT,
      type               TEXT,
      start_time         TEXT,
      start_time_local   TEXT,
      distance_m         REAL,
      duration_s         REAL,
      moving_duration_s  REAL,
      elapsed_duration_s REAL,
      avg_hr             INTEGER,
      max_hr             INTEGER,
      avg_cadence        REAL,
      max_cadence        REAL,
      avg_power          REAL,
      max_power          REAL,
      norm_power         REAL,
      avg_speed_mps      REAL,
      max_speed_mps      REAL,
      elevation_gain_m   REAL,
      elevation_loss_m   REAL,
      calories           INTEGER,
      aerobic_te         REAL,
      anaerobic_te       REAL,
      training_load      REAL,
      vo2max             REAL,
      activity_steps     INTEGER,
      body_battery_delta INTEGER,
      avg_respiration_rate REAL,
      hr_zone_1_s        INTEGER,
      hr_zone_2_s        INTEGER,
      hr_zone_3_s        INTEGER,
      hr_zone_4_s        INTEGER,
      hr_zone_5_s        INTEGER,
      fastest_km_s       REAL,
      fastest_5k_s       REAL,
      temp_avg_c         REAL,
      water_estimated_ml REAL,
      stamina_start      REAL,
      stamina_end        REAL,
      stamina_min        REAL,
      ground_contact_ms  REAL,
      ground_contact_balance_left REAL,
      vertical_oscillation_cm REAL,
      vertical_ratio_pct REAL,
      stride_length_cm   REAL
    );
    CREATE TABLE activity_split (
      activity_id             TEXT NOT NULL,
      split_index             INTEGER NOT NULL,
      split_type              TEXT,
      distance_m              REAL,
      duration_s              REAL,
      moving_duration_s       REAL,
      avg_hr                  INTEGER,
      max_hr                  INTEGER,
      avg_speed_mps           REAL,
      avg_cadence             REAL,
      avg_power               REAL,
      calories                INTEGER,
      elevation_gain_m        REAL,
      elevation_loss_m        REAL,
      ground_contact_ms       REAL,
      vertical_oscillation_cm REAL,
      PRIMARY KEY (activity_id, split_index)
    );
  `);
  const insertDaily = db.prepare(
    `INSERT INTO daily_summary (date, total_steps, avg_stress_level, body_battery_highest,
                                body_battery_lowest, moderate_intensity_minutes, vigorous_intensity_minutes)
     VALUES (@date, @total_steps, @avg_stress_level, @body_battery_highest,
             @body_battery_lowest, @moderate_intensity_minutes, @vigorous_intensity_minutes)`,
  );
  const insertHr = db.prepare(
    `INSERT INTO heart_rate (date, resting_hr) VALUES (@date, @resting_hr)`,
  );
  const insertSleep = db.prepare(
    `INSERT INTO sleep (date, sleep_score, total_sleep_seconds, deep_sleep_seconds,
                        light_sleep_seconds, rem_sleep_seconds, awake_seconds)
     VALUES (@date, @sleep_score, @total_sleep_seconds, @deep_sleep_seconds,
             @light_sleep_seconds, @rem_sleep_seconds, @awake_seconds)`,
  );
  const insertHrv = db.prepare(
    `INSERT INTO hrv (date, last_night_avg, weekly_avg, baseline_low, baseline_high)
     VALUES (@date, @hrv_nightly, @hrv_weekly, @hrv_baseline_low, @hrv_baseline_high)`,
  );
  const insertBb = db.prepare(
    `INSERT INTO body_battery (date, charged, drained) VALUES (@date, @bb_charged, @bb_drained)`,
  );
  for (const row of rows) {
    const full: Required<DailySummarySeed> = {
      resting_hr: null,
      total_steps: null,
      avg_stress_level: null,
      body_battery_highest: null,
      body_battery_lowest: null,
      moderate_intensity_minutes: null,
      vigorous_intensity_minutes: null,
      sleep_score: null,
      total_sleep_seconds: null,
      deep_sleep_seconds: null,
      light_sleep_seconds: null,
      rem_sleep_seconds: null,
      awake_seconds: null,
      hrv_nightly: null,
      hrv_weekly: null,
      hrv_baseline_low: null,
      hrv_baseline_high: null,
      bb_charged: null,
      bb_drained: null,
      ...row,
    };
    insertDaily.run(full);
    if (full.resting_hr != null) insertHr.run(full);
    if (full.sleep_score != null || full.total_sleep_seconds != null) insertSleep.run(full);
    if (full.hrv_nightly != null) insertHrv.run(full);
    if (full.bb_charged != null) insertBb.run(full);
  }
  const insertActivity = db.prepare(
    `INSERT INTO activity (activity_id, name, type, start_time_local, distance_m,
                           duration_s, avg_hr, elevation_gain_m, avg_cadence, avg_power,
                           ground_contact_ms, ground_contact_balance_left,
                           vertical_oscillation_cm, vertical_ratio_pct, stride_length_cm)
     VALUES (@activity_id, @name, @type, @start_time_local, @distance_m,
             @duration_s, @avg_hr, @elevation_gain_m, @avg_cadence, @avg_power,
             @ground_contact_ms, @ground_contact_balance_left,
             @vertical_oscillation_cm, @vertical_ratio_pct, @stride_length_cm)`,
  );
  for (const a of activities) {
    insertActivity.run({
      name: null,
      type: null,
      start_time_local: null,
      distance_m: null,
      duration_s: null,
      avg_hr: null,
      elevation_gain_m: null,
      avg_cadence: null,
      avg_power: null,
      ground_contact_ms: null,
      ground_contact_balance_left: null,
      vertical_oscillation_cm: null,
      vertical_ratio_pct: null,
      stride_length_cm: null,
      ...a,
    });
  }
  const insertSplit = db.prepare(
    `INSERT INTO activity_split (activity_id, split_index, split_type, distance_m, duration_s, avg_hr)
     VALUES (@activity_id, @split_index, @split_type, @distance_m, @duration_s, @avg_hr)`,
  );
  for (const s of splits) {
    insertSplit.run({
      split_type: null,
      distance_m: null,
      duration_s: null,
      avg_hr: null,
      ...s,
    });
  }
  db.close();
  return path;
}

const PERF_SCHEMA = `
  CREATE TABLE training_status (
    date TEXT PRIMARY KEY, vo2max REAL, vo2max_precise REAL, acute_load INTEGER,
    chronic_load INTEGER, acwr REAL, training_status_phrase TEXT
  );
  CREATE TABLE training_readiness (
    date TEXT PRIMARY KEY, score INTEGER, hrv_factor_pct INTEGER, sleep_factor_pct INTEGER,
    stress_factor_pct INTEGER, recovery_time_min INTEGER
  );
  CREATE TABLE race_predictions (
    date TEXT PRIMARY KEY, race_5k_s INTEGER, race_10k_s INTEGER, race_half_s INTEGER, race_full_s INTEGER
  );
  CREATE TABLE max_metrics (date TEXT PRIMARY KEY, vo2max REAL, vo2max_precise REAL, fitness_age REAL);
  CREATE TABLE lactate_threshold (date TEXT PRIMARY KEY, threshold_hr INTEGER, threshold_power_w REAL);
  CREATE TABLE endurance_score (date TEXT PRIMARY KEY, score INTEGER);
  CREATE TABLE hill_score (date TEXT PRIMARY KEY, overall_score INTEGER, strength_score INTEGER, hill_endurance_score INTEGER);
  CREATE TABLE fitness_age (date TEXT PRIMARY KEY, fitness_age REAL);
  CREATE TABLE activity (
    activity_id TEXT PRIMARY KEY, type TEXT, start_time_local TEXT,
    hr_zone_1_s INTEGER, hr_zone_2_s INTEGER, hr_zone_3_s INTEGER, hr_zone_4_s INTEGER, hr_zone_5_s INTEGER
  );
`;

/**
 * Creates a throwaway database with the performance/training tables (and an
 * activity table for intensity). Seed is keyed by table name; each row object's
 * keys are inserted directly, so a test only specifies the columns it cares
 * about. Test-controlled input, so the dynamic column list is safe.
 */
function seedTables(db: Database.Database, seed: Record<string, Record<string, unknown>[]>): void {
  for (const [table, tableRows] of Object.entries(seed)) {
    for (const row of tableRows) {
      const cols = Object.keys(row);
      db.prepare(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`,
      ).run(row);
    }
  }
}

export function createPerfDb(seed: Record<string, Record<string, unknown>[]>): string {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-vis-perf-'));
  const path = join(dir, 'perf.db');
  const db = new Database(path);
  db.exec(PERF_SCHEMA);
  seedTables(db, seed);
  db.close();
  return path;
}

// Every table referenced by the metric catalog, with the columns its SQL reads.
const METRICS_SCHEMA = `
  CREATE TABLE daily_summary (date TEXT PRIMARY KEY, total_steps INTEGER, avg_stress_level INTEGER, body_battery_highest INTEGER);
  CREATE TABLE heart_rate (date TEXT PRIMARY KEY, resting_hr INTEGER);
  CREATE TABLE sleep (date TEXT PRIMARY KEY, sleep_score INTEGER, total_sleep_seconds INTEGER, deep_sleep_seconds INTEGER, rem_sleep_seconds INTEGER);
  CREATE TABLE hrv (date TEXT PRIMARY KEY, last_night_avg INTEGER, weekly_avg INTEGER);
  CREATE TABLE training_status (date TEXT PRIMARY KEY, vo2max REAL, acute_load INTEGER, chronic_load INTEGER, acwr REAL);
  CREATE TABLE training_readiness (date TEXT PRIMARY KEY, score INTEGER, recovery_time_min INTEGER);
  CREATE TABLE race_predictions (date TEXT PRIMARY KEY, race_5k_s INTEGER);
  CREATE TABLE max_metrics (date TEXT PRIMARY KEY, vo2max REAL);
  CREATE TABLE endurance_score (date TEXT PRIMARY KEY, score INTEGER);
  CREATE TABLE hill_score (date TEXT PRIMARY KEY, overall_score INTEGER);
  CREATE TABLE fitness_age (date TEXT PRIMARY KEY, fitness_age REAL);
  CREATE TABLE activity (
    activity_id TEXT PRIMARY KEY, type TEXT, start_time_local TEXT,
    avg_cadence REAL, avg_power REAL, ground_contact_ms REAL,
    ground_contact_balance_left REAL, vertical_oscillation_cm REAL,
    vertical_ratio_pct REAL, stride_length_cm REAL
  );
`;

export function createMetricsDb(seed: Record<string, Record<string, unknown>[]>): string {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-vis-metrics-'));
  const path = join(dir, 'metrics.db');
  const db = new Database(path);
  db.exec(METRICS_SCHEMA);
  seedTables(db, seed);
  db.close();
  return path;
}

// Activity table with the columns the records queries read.
const RECORDS_SCHEMA = `
  CREATE TABLE activity (
    activity_id TEXT PRIMARY KEY, type TEXT, start_time_local TEXT,
    distance_m REAL, duration_s REAL, elevation_gain_m REAL, vo2max REAL,
    fastest_km_s REAL, fastest_mile_s REAL, fastest_5k_s REAL
  );
`;

export function createRecordsDb(activities: Record<string, unknown>[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-vis-records-'));
  const path = join(dir, 'records.db');
  const db = new Database(path);
  db.exec(RECORDS_SCHEMA);
  seedTables(db, { activity: activities });
  db.close();
  return path;
}
