import type { Database } from 'better-sqlite3';
import type { DailyHealthPoint, Granularity } from '@fitness/shared';

const BUCKET_EXPR: Record<Exclude<Granularity, 'day'>, string> = {
  week: "strftime('%Y-%W', d.date)",
  month: "strftime('%Y-%m', d.date)",
  year: "strftime('%Y', d.date)",
};

// Column expressions shared by the day and aggregate queries.
// Sources verified against real data:
// - resting HR lives in heart_rate (daily_summary.resting_hr is never populated)
// - body_battery.starting_value/ending_value are never populated; highs/lows
//   come from daily_summary
// - stress duration buckets are never populated; only avg/max levels are
const COLUMNS: [name: string, expr: string][] = [
  ['resting_hr', 'h.resting_hr'],
  ['total_steps', 'd.total_steps'],
  ['avg_stress_level', 'd.avg_stress_level'],
  ['sleep_score', 's.sleep_score'],
  ['sleep_total_s', 's.total_sleep_seconds'],
  ['sleep_deep_s', 's.deep_sleep_seconds'],
  ['sleep_light_s', 's.light_sleep_seconds'],
  ['sleep_rem_s', 's.rem_sleep_seconds'],
  ['sleep_awake_s', 's.awake_seconds'],
  ['hrv_nightly', 'v.last_night_avg'],
  ['hrv_weekly', 'v.weekly_avg'],
  ['hrv_baseline_low', 'v.baseline_low'],
  ['hrv_baseline_high', 'v.baseline_high'],
  ['body_battery_charged', 'bb.charged'],
  ['body_battery_drained', 'bb.drained'],
  ['body_battery_high', 'd.body_battery_highest'],
  ['body_battery_low', 'd.body_battery_lowest'],
  ['moderate_intensity_min', 'd.moderate_intensity_minutes'],
  ['vigorous_intensity_min', 'd.vigorous_intensity_minutes'],
];

const JOINS = `
  FROM daily_summary d
  LEFT JOIN heart_rate h   ON h.date = d.date
  LEFT JOIN sleep s        ON s.date = d.date
  LEFT JOIN hrv v          ON v.date = d.date
  LEFT JOIN body_battery bb ON bb.date = d.date
`;

interface Row {
  date: string;
  [column: string]: string | number | null;
}

function num(row: Row, column: string): number | null {
  const value = row[column];
  return typeof value === 'number' ? value : null;
}

export function getDailyHealth(
  db: Database,
  from: string,
  to: string,
  granularity: Granularity,
): DailyHealthPoint[] {
  const select =
    granularity === 'day'
      ? COLUMNS.map(([name, expr]) => `${expr} AS ${name}`).join(', ')
      : COLUMNS.map(([name, expr]) => `ROUND(AVG(${expr}), 1) AS ${name}`).join(', ');

  const sql = `
    SELECT MIN(d.date) AS date, ${select}
    ${JOINS}
    WHERE d.date BETWEEN @from AND @to
    GROUP BY ${granularity === 'day' ? 'd.date' : BUCKET_EXPR[granularity]}
    ORDER BY date`;

  const rows = db.prepare(sql).all({ from, to }) as Row[];
  return rows.map((r) => ({
    date: r.date,
    restingHr: num(r, 'resting_hr'),
    totalSteps: num(r, 'total_steps'),
    avgStressLevel: num(r, 'avg_stress_level'),
    sleepScore: num(r, 'sleep_score'),
    sleepTotalS: num(r, 'sleep_total_s'),
    sleepDeepS: num(r, 'sleep_deep_s'),
    sleepLightS: num(r, 'sleep_light_s'),
    sleepRemS: num(r, 'sleep_rem_s'),
    sleepAwakeS: num(r, 'sleep_awake_s'),
    hrvNightly: num(r, 'hrv_nightly'),
    hrvWeekly: num(r, 'hrv_weekly'),
    hrvBaselineLow: num(r, 'hrv_baseline_low'),
    hrvBaselineHigh: num(r, 'hrv_baseline_high'),
    bodyBatteryCharged: num(r, 'body_battery_charged'),
    bodyBatteryDrained: num(r, 'body_battery_drained'),
    bodyBatteryHigh: num(r, 'body_battery_high'),
    bodyBatteryLow: num(r, 'body_battery_low'),
    moderateIntensityMin: num(r, 'moderate_intensity_min'),
    vigorousIntensityMin: num(r, 'vigorous_intensity_min'),
  }));
}
