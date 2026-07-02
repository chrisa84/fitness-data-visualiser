import type { Database } from 'better-sqlite3';
import type { FormVsPacePoint, Granularity, RunningDynamicsPoint } from '@fitness/shared';
import { typeFilterClause } from './activities.js';

const BUCKET: Record<Granularity, string> = {
  day: 'date(start_time_local)',
  week: "strftime('%Y-%W', start_time_local)",
  month: "strftime('%Y-%m', start_time_local)",
  year: "strftime('%Y', start_time_local)",
};

/**
 * Running-form metrics averaged per bucket over the matching activities. These
 * columns live on the activity table and are only recorded by dynamics-capable
 * sensors, so a bucket carries a value only where at least one activity has it.
 */
export function getRunningDynamics(
  db: Database,
  from: string,
  to: string,
  granularity: Granularity,
  types?: string[],
): RunningDynamicsPoint[] {
  const params: Record<string, unknown> = { from, to };
  const typeClause = typeFilterClause(types, params);
  return db
    .prepare(
      `SELECT MIN(date(start_time_local))                AS date,
              ROUND(AVG(ground_contact_ms), 1)           AS groundContactMs,
              ROUND(AVG(ground_contact_balance_left), 1) AS balanceLeftPct,
              ROUND(AVG(vertical_oscillation_cm), 2)     AS verticalOscillationCm,
              ROUND(AVG(vertical_ratio_pct), 2)          AS verticalRatioPct,
              ROUND(AVG(stride_length_cm), 1)            AS strideLengthCm,
              ROUND(AVG(avg_cadence), 1)                 AS avgCadence,
              ROUND(AVG(avg_power), 1)                   AS avgPower
       FROM activity
       WHERE date(start_time_local) BETWEEN @from AND @to
         ${typeClause ? `AND ${typeClause}` : ''}
         AND (ground_contact_ms IS NOT NULL OR vertical_oscillation_cm IS NOT NULL
              OR stride_length_cm IS NOT NULL OR avg_cadence IS NOT NULL)
       GROUP BY ${BUCKET[granularity]}
       ORDER BY date`,
    )
    .all(params) as RunningDynamicsPoint[];
}

/**
 * Per-activity form metrics vs average speed, for the form-vs-pace scatter.
 * Only activities with a usable speed and at least one form metric qualify.
 */
export function getFormVsPace(
  db: Database,
  from: string,
  to: string,
  types?: string[],
): FormVsPacePoint[] {
  const params: Record<string, unknown> = { from, to };
  const typeClause = typeFilterClause(types, params);
  return db
    .prepare(
      `SELECT date(start_time_local)       AS date,
              avg_speed_mps                AS avgSpeedMps,
              vertical_oscillation_cm      AS verticalOscillationCm,
              vertical_ratio_pct           AS verticalRatioPct,
              avg_cadence                  AS avgCadence,
              ground_contact_ms            AS groundContactMs,
              distance_m                   AS distanceM
       FROM activity
       WHERE date(start_time_local) BETWEEN @from AND @to
         ${typeClause ? `AND ${typeClause}` : ''}
         AND avg_speed_mps IS NOT NULL AND avg_speed_mps > 0
         AND (vertical_oscillation_cm IS NOT NULL OR vertical_ratio_pct IS NOT NULL
              OR avg_cadence IS NOT NULL OR ground_contact_ms IS NOT NULL)
       ORDER BY date`,
    )
    .all(params) as FormVsPacePoint[];
}
