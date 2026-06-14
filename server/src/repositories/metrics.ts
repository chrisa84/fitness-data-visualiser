import type { Database } from 'better-sqlite3';
import type { Granularity, MetricPoint } from '@fitness/shared';
import { METRIC_KEYS } from '@fitness/shared';

type TableName =
  | 'daily_summary'
  | 'heart_rate'
  | 'sleep'
  | 'hrv'
  | 'body_battery'
  | 'training_status'
  | 'training_readiness'
  | 'race_predictions'
  | 'max_metrics'
  | 'endurance_score'
  | 'hill_score'
  | 'fitness_age'
  | 'run_dynamics';

interface MetricSql {
  expr: string;
  tables: TableName[];
}

// Running activity types whose dynamics feed the daily averages below.
const RUN_TYPES = "('running','trail_running','treadmill_running','obstacle_run')";

// Derived daily sources: a name → subquery yielding (date, ...columns). The
// spine/join builder treats these like a table, so per-activity metrics (running
// dynamics) can join the daily date spine. `run_dynamics` averages each form
// metric over a day's runs.
const DERIVED_SOURCES: Record<string, string> = {
  run_dynamics: `SELECT date(start_time_local) AS date,
      AVG(ground_contact_ms)           AS gct,
      AVG(ground_contact_balance_left) AS balance,
      AVG(vertical_oscillation_cm)     AS vosc,
      AVG(vertical_ratio_pct)          AS vratio,
      AVG(stride_length_cm)            AS stride,
      AVG(avg_cadence)                 AS cadence,
      AVG(avg_power)                   AS power
    FROM activity
    WHERE type IN ${RUN_TYPES} AND start_time_local IS NOT NULL
    GROUP BY date(start_time_local)`,
};

/** A `FROM`/`JOIN` fragment for a source: a bare table, or an aliased subquery. */
function sourceRef(t: string): string {
  return t in DERIVED_SOURCES ? `(${DERIVED_SOURCES[t]}) ${t}` : t;
}

// SQL for each catalog key: the column expression and the table(s) it reads.
// Kept in lockstep with METRIC_CATALOG in shared (asserted by a test).
const METRIC_SQL: Record<string, MetricSql> = {
  resting_hr: { expr: 'heart_rate.resting_hr', tables: ['heart_rate'] },
  steps: { expr: 'daily_summary.total_steps', tables: ['daily_summary'] },
  stress: { expr: 'daily_summary.avg_stress_level', tables: ['daily_summary'] },
  sleep_score: { expr: 'sleep.sleep_score', tables: ['sleep'] },
  sleep_hours: { expr: 'sleep.total_sleep_seconds / 3600.0', tables: ['sleep'] },
  sleep_deep_hours: { expr: 'sleep.deep_sleep_seconds / 3600.0', tables: ['sleep'] },
  sleep_rem_hours: { expr: 'sleep.rem_sleep_seconds / 3600.0', tables: ['sleep'] },
  hrv_nightly: { expr: 'hrv.last_night_avg', tables: ['hrv'] },
  hrv_weekly: { expr: 'hrv.weekly_avg', tables: ['hrv'] },
  body_battery_high: { expr: 'daily_summary.body_battery_highest', tables: ['daily_summary'] },
  readiness: { expr: 'training_readiness.score', tables: ['training_readiness'] },
  recovery_time: { expr: 'training_readiness.recovery_time_min', tables: ['training_readiness'] },
  training_load_acute: { expr: 'training_status.acute_load', tables: ['training_status'] },
  training_load_chronic: { expr: 'training_status.chronic_load', tables: ['training_status'] },
  acwr: { expr: 'training_status.acwr', tables: ['training_status'] },
  vo2max: {
    expr: 'COALESCE(training_status.vo2max, max_metrics.vo2max)',
    tables: ['training_status', 'max_metrics'],
  },
  race_5k: { expr: 'race_predictions.race_5k_s', tables: ['race_predictions'] },
  endurance_score: { expr: 'endurance_score.score', tables: ['endurance_score'] },
  hill_score: { expr: 'hill_score.overall_score', tables: ['hill_score'] },
  fitness_age: { expr: 'fitness_age.fitness_age', tables: ['fitness_age'] },
  gct: { expr: 'run_dynamics.gct', tables: ['run_dynamics'] },
  run_balance: { expr: 'run_dynamics.balance', tables: ['run_dynamics'] },
  vertical_oscillation: { expr: 'run_dynamics.vosc', tables: ['run_dynamics'] },
  vertical_ratio: { expr: 'run_dynamics.vratio', tables: ['run_dynamics'] },
  stride_length: { expr: 'run_dynamics.stride', tables: ['run_dynamics'] },
  run_cadence: { expr: 'run_dynamics.cadence', tables: ['run_dynamics'] },
  run_power: { expr: 'run_dynamics.power', tables: ['run_dynamics'] },
};

export const METRIC_SQL_KEYS = Object.keys(METRIC_SQL);

const BUCKET_EXPR: Record<Exclude<Granularity, 'day'>, string> = {
  week: "strftime('%Y-%W', d.date)",
  month: "strftime('%Y-%m', d.date)",
  year: "strftime('%Y', d.date)",
};

function num(value: unknown): number | null {
  return typeof value === 'number' ? Math.round(value * 100) / 100 : null;
}

/**
 * Returns a daily (or bucketed) series carrying a value for each requested
 * metric key. Only the tables needed by the requested keys are unioned into the
 * date spine and joined, so unrelated tables are never scanned.
 */
export function getMetricSeries(
  db: Database,
  keys: string[],
  from: string,
  to: string,
  granularity: Granularity,
): MetricPoint[] {
  const valid = keys.filter((k) => k in METRIC_SQL);
  if (valid.length === 0) return [];

  const tables = [...new Set(valid.flatMap((k) => METRIC_SQL[k]!.tables))];
  const spine = tables
    .map((t) => `SELECT date FROM ${sourceRef(t)} WHERE date BETWEEN @from AND @to`)
    .join(' UNION ');
  const joins = tables.map((t) => `LEFT JOIN ${sourceRef(t)} ON ${t}.date = d.date`).join('\n');

  const isDay = granularity === 'day';
  const select = valid
    .map((k) => {
      const { expr } = METRIC_SQL[k]!;
      return isDay ? `${expr} AS "${k}"` : `AVG(${expr}) AS "${k}"`;
    })
    .join(', ');

  const sql = `
    WITH d AS (${spine})
    SELECT MIN(d.date) AS date, ${select}
    FROM d
    ${joins}
    GROUP BY ${isDay ? 'd.date' : BUCKET_EXPR[granularity]}
    ORDER BY date`;

  const rows = db.prepare(sql).all({ from, to }) as Record<string, unknown>[];
  return rows.map((r) => ({
    date: r.date as string,
    values: Object.fromEntries(valid.map((k) => [k, num(r[k])])),
  }));
}

/** Exposed for a drift test: catalog keys must exactly match the SQL map. */
export function catalogKeysMatchSql(): boolean {
  return (
    METRIC_KEYS.length === METRIC_SQL_KEYS.length &&
    METRIC_KEYS.every((k) => k in METRIC_SQL)
  );
}
