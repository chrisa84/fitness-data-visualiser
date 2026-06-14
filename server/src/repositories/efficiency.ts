import type { Database } from 'better-sqlite3';
import type { EfficiencyPoint, Granularity } from '@fitness/shared';
import { typeFilterClause } from './activities.js';

const BUCKET: Record<Granularity, string> = {
  day: 'date(start_time_local)',
  week: "strftime('%Y-%W', start_time_local)",
  month: "strftime('%Y-%m', start_time_local)",
  year: "strftime('%Y', start_time_local)",
};

export interface EfficiencyOptions {
  from: string;
  to: string;
  granularity: Granularity;
  types?: string[];
  hrMin: number;
  hrMax: number;
}

/**
 * Effort-adjusted efficiency per bucket. EF averages metres-per-minute-per-beat
 * over the runs that have both speed and HR; the band pace averages sec/km over
 * runs whose average HR sat inside [hrMin, hrMax].
 */
export function getEfficiencySeries(db: Database, opts: EfficiencyOptions): EfficiencyPoint[] {
  const params: Record<string, unknown> = {
    from: opts.from,
    to: opts.to,
    hrMin: opts.hrMin,
    hrMax: opts.hrMax,
  };
  const typeClause = typeFilterClause(opts.types, params);
  return db
    .prepare(
      `SELECT MIN(date(start_time_local)) AS date,
              ROUND(AVG(CASE WHEN avg_hr > 0 AND avg_speed_mps > 0
                             THEN (avg_speed_mps * 60.0) / avg_hr END), 3) AS efficiencyFactor,
              ROUND(AVG(CASE WHEN avg_hr BETWEEN @hrMin AND @hrMax AND distance_m > 0
                             THEN duration_s / (distance_m / 1000.0) END), 1) AS paceInBandS,
              COUNT(*) AS runs,
              SUM(CASE WHEN avg_hr BETWEEN @hrMin AND @hrMax AND distance_m > 0 THEN 1 ELSE 0 END) AS runsInBand
       FROM activity
       WHERE date(start_time_local) BETWEEN @from AND @to
         AND avg_hr IS NOT NULL
         ${typeClause ? `AND ${typeClause}` : ''}
       GROUP BY ${BUCKET[opts.granularity]}
       ORDER BY date`,
    )
    .all(params) as EfficiencyPoint[];
}
