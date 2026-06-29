import type { Database } from 'better-sqlite3';
import type {
  IntradayHrPoint,
  IntradayRespirationPoint,
  IntradayResponse,
  IntradayStepsPoint,
  IntradayStressPoint,
} from '@fitness/shared';

export function getIntraday(db: Database, date: string): IntradayResponse {
  const hrRows = db
    .prepare(
      `SELECT timestamp_utc, heart_rate FROM intraday_heart_rate WHERE date = ? ORDER BY timestamp_utc ASC`,
    )
    .all(date) as { timestamp_utc: string; heart_rate: number }[];

  const stressRows = db
    .prepare(
      `SELECT timestamp_utc, stress_level FROM intraday_stress WHERE date = ? ORDER BY timestamp_utc ASC`,
    )
    .all(date) as { timestamp_utc: string; stress_level: number | null }[];

  const stepsRows = db
    .prepare(
      `SELECT timestamp_utc, steps, activity_level FROM intraday_steps WHERE date = ? ORDER BY timestamp_utc ASC`,
    )
    .all(date) as { timestamp_utc: string; steps: number; activity_level: number | null }[];

  const respirationRows = db
    .prepare(
      `SELECT timestamp_utc, breaths_per_min FROM intraday_respiration WHERE date = ? ORDER BY timestamp_utc ASC`,
    )
    .all(date) as { timestamp_utc: string; breaths_per_min: number }[];

  return {
    date,
    heartRate: hrRows.map((r): IntradayHrPoint => ({ timestampUtc: r.timestamp_utc, heartRate: r.heart_rate })),
    stress: stressRows.map((r): IntradayStressPoint => ({ timestampUtc: r.timestamp_utc, stressLevel: r.stress_level })),
    steps: stepsRows.map(
      (r): IntradayStepsPoint => ({ timestampUtc: r.timestamp_utc, steps: r.steps, activityLevel: r.activity_level }),
    ),
    respiration: respirationRows.map(
      (r): IntradayRespirationPoint => ({ timestampUtc: r.timestamp_utc, breathsPerMin: r.breaths_per_min }),
    ),
  };
}
