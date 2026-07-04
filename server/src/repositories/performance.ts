import type { Database } from 'better-sqlite3';
import type { Granularity, IntensityPoint, PerformancePoint } from '@fitness/shared';
import { typeFilterClause } from './activities.js';

const BUCKET_EXPR: Record<Exclude<Granularity, 'day'>, string> = {
  week: "date(d.date, 'weekday 0', '-6 days')",
  month: "strftime('%Y-%m', d.date)",
  year: "strftime('%Y', d.date)",
};

// Numeric metric columns: [output name, SQL expression]. VO2max falls back to
// max_metrics when training_status has no value for the day.
const COLUMNS: [name: string, expr: string][] = [
  ['vo2max', 'COALESCE(ts.vo2max, mm.vo2max)'],
  ['vo2max_precise', 'COALESCE(ts.vo2max_precise, mm.vo2max_precise)'],
  ['fitness_age', 'fa.fitness_age'],
  ['acute_load', 'ts.acute_load'],
  ['chronic_load', 'ts.chronic_load'],
  ['acwr', 'ts.acwr'],
  ['readiness_score', 'tr.score'],
  ['readiness_hrv_pct', 'tr.hrv_factor_pct'],
  ['readiness_sleep_pct', 'tr.sleep_factor_pct'],
  ['readiness_stress_pct', 'tr.stress_factor_pct'],
  ['recovery_time_min', 'tr.recovery_time_min'],
  ['race_5k_s', 'rp.race_5k_s'],
  ['race_10k_s', 'rp.race_10k_s'],
  ['race_half_s', 'rp.race_half_s'],
  ['race_full_s', 'rp.race_full_s'],
  ['lactate_threshold_hr', 'lt.threshold_hr'],
  ['lactate_threshold_power_w', 'lt.threshold_power_w'],
  ['endurance_score', 'es.score'],
  ['hill_score', 'hs.overall_score'],
  ['hill_strength', 'hs.strength_score'],
  ['hill_endurance', 'hs.hill_endurance_score'],
];

// A date spine across every date-keyed performance table, so a row appears
// whenever any single metric exists for that day.
const DATE_SPINE = `
  WITH d AS (
    SELECT date FROM training_status    WHERE date BETWEEN @from AND @to
    UNION SELECT date FROM training_readiness WHERE date BETWEEN @from AND @to
    UNION SELECT date FROM race_predictions   WHERE date BETWEEN @from AND @to
    UNION SELECT date FROM max_metrics        WHERE date BETWEEN @from AND @to
    UNION SELECT date FROM lactate_threshold  WHERE date BETWEEN @from AND @to
    UNION SELECT date FROM endurance_score    WHERE date BETWEEN @from AND @to
    UNION SELECT date FROM hill_score         WHERE date BETWEEN @from AND @to
    UNION SELECT date FROM fitness_age        WHERE date BETWEEN @from AND @to
  )`;

const JOINS = `
  FROM d
  LEFT JOIN training_status    ts ON ts.date = d.date
  LEFT JOIN training_readiness tr ON tr.date = d.date
  LEFT JOIN race_predictions   rp ON rp.date = d.date
  LEFT JOIN max_metrics        mm ON mm.date = d.date
  LEFT JOIN lactate_threshold  lt ON lt.date = d.date
  LEFT JOIN endurance_score    es ON es.date = d.date
  LEFT JOIN hill_score         hs ON hs.date = d.date
  LEFT JOIN fitness_age        fa ON fa.date = d.date
`;

interface Row {
  date: string;
  training_status: string | null;
  [column: string]: string | number | null;
}

function num(row: Row, column: string): number | null {
  const value = row[column];
  return typeof value === 'number' ? value : null;
}

export function getPerformanceSeries(
  db: Database,
  from: string,
  to: string,
  granularity: Granularity,
): PerformancePoint[] {
  const isDay = granularity === 'day';
  const metricSelect = isDay
    ? COLUMNS.map(([name, expr]) => `${expr} AS ${name}`).join(', ')
    : COLUMNS.map(([name, expr]) => `ROUND(AVG(${expr}), 2) AS ${name}`).join(', ');
  // The status phrase can't be averaged, so it is only meaningful per day.
  const statusSelect = isDay ? 'ts.training_status_phrase AS training_status' : 'NULL AS training_status';

  const sql = `
    ${DATE_SPINE}
    SELECT MIN(d.date) AS date, ${statusSelect}, ${metricSelect}
    ${JOINS}
    GROUP BY ${isDay ? 'd.date' : BUCKET_EXPR[granularity]}
    ORDER BY date`;

  const rows = db.prepare(sql).all({ from, to }) as Row[];
  return rows.map((r) => ({
    date: r.date,
    trainingStatus: r.training_status,
    vo2max: num(r, 'vo2max'),
    vo2maxPrecise: num(r, 'vo2max_precise'),
    fitnessAge: num(r, 'fitness_age'),
    acuteLoad: num(r, 'acute_load'),
    chronicLoad: num(r, 'chronic_load'),
    acwr: num(r, 'acwr'),
    readinessScore: num(r, 'readiness_score'),
    readinessHrvPct: num(r, 'readiness_hrv_pct'),
    readinessSleepPct: num(r, 'readiness_sleep_pct'),
    readinessStressPct: num(r, 'readiness_stress_pct'),
    recoveryTimeMin: num(r, 'recovery_time_min'),
    race5kS: num(r, 'race_5k_s'),
    race10kS: num(r, 'race_10k_s'),
    raceHalfS: num(r, 'race_half_s'),
    raceFullS: num(r, 'race_full_s'),
    lactateThresholdHr: num(r, 'lactate_threshold_hr'),
    lactateThresholdPowerW: num(r, 'lactate_threshold_power_w'),
    enduranceScore: num(r, 'endurance_score'),
    hillScore: num(r, 'hill_score'),
    hillStrength: num(r, 'hill_strength'),
    hillEndurance: num(r, 'hill_endurance'),
  }));
}

const INTENSITY_BUCKET: Record<Granularity, string> = {
  day: 'date(start_time_local)',
  week: "date(start_time_local, 'weekday 0', '-6 days')",
  month: "strftime('%Y-%m', start_time_local)",
  year: "strftime('%Y', start_time_local)",
};

export function getIntensityDistribution(
  db: Database,
  from: string,
  to: string,
  granularity: Granularity,
  types?: string[],
): IntensityPoint[] {
  const params: Record<string, unknown> = { from, to };
  const typeClause = typeFilterClause(types, params);
  const rows = db
    .prepare(
      `SELECT MIN(date(start_time_local))    AS date,
              COALESCE(SUM(hr_zone_1_s), 0)  AS zone1S,
              COALESCE(SUM(hr_zone_2_s), 0)  AS zone2S,
              COALESCE(SUM(hr_zone_3_s), 0)  AS zone3S,
              COALESCE(SUM(hr_zone_4_s), 0)  AS zone4S,
              COALESCE(SUM(hr_zone_5_s), 0)  AS zone5S
       FROM activity
       WHERE date(start_time_local) BETWEEN @from AND @to
         ${typeClause ? `AND ${typeClause}` : ''}
         AND (hr_zone_1_s IS NOT NULL OR hr_zone_2_s IS NOT NULL OR hr_zone_3_s IS NOT NULL
              OR hr_zone_4_s IS NOT NULL OR hr_zone_5_s IS NOT NULL)
       GROUP BY ${INTENSITY_BUCKET[granularity]}
       ORDER BY date`,
    )
    .all(params) as IntensityPoint[];
  return rows;
}
