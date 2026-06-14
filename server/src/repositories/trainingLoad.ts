import type { Database } from 'better-sqlite3';
import type { TrainingLoadPoint } from '@fitness/shared';

interface Row {
  date: string;
  weeklyLoad: number;
  meanLoad: number;
  variance: number;
  days: number;
}

/**
 * Weekly training monotony and strain (Foster). Daily load is the sum of
 * activity training load; a date spine (bounded to the data's own extent) makes
 * rest days count as zero, which is essential — monotony is driven by the spread
 * between hard and easy/rest days.
 */
export function getTrainingLoadStrain(db: Database, from: string, to: string): TrainingLoadPoint[] {
  const rows = db
    .prepare(
      `WITH RECURSIVE bounds AS (
         SELECT MAX(@from, MIN(date(start_time_local))) AS d0,
                MIN(@to,   MAX(date(start_time_local))) AS d1
         FROM activity
       ),
       days(d) AS (
         SELECT d0 FROM bounds WHERE d0 IS NOT NULL
         UNION ALL
         SELECT date(d, '+1 day') FROM days WHERE d < (SELECT d1 FROM bounds)
       ),
       act AS (
         SELECT date(start_time_local) AS d, SUM(training_load) AS load
         FROM activity WHERE training_load IS NOT NULL
         GROUP BY date(start_time_local)
       )
       SELECT MIN(days.d)                                                    AS date,
              ROUND(SUM(COALESCE(act.load, 0)), 1)                           AS weeklyLoad,
              AVG(COALESCE(act.load, 0))                                     AS meanLoad,
              AVG(COALESCE(act.load, 0) * COALESCE(act.load, 0))
                - AVG(COALESCE(act.load, 0)) * AVG(COALESCE(act.load, 0))    AS variance,
              COUNT(*)                                                       AS days
       FROM days LEFT JOIN act ON act.d = days.d
       GROUP BY strftime('%Y-%W', days.d)
       ORDER BY date`,
    )
    .all({ from, to }) as Row[];

  return rows.map((r) => {
    const sd = Math.sqrt(Math.max(0, r.variance));
    const monotony = sd > 0 ? r.meanLoad / sd : null;
    const strain = monotony != null ? Math.round(r.weeklyLoad * monotony) : null;
    return {
      date: r.date,
      weeklyLoad: r.weeklyLoad,
      meanLoad: Math.round(r.meanLoad * 10) / 10,
      monotony: monotony != null ? Math.round(monotony * 100) / 100 : null,
      strain,
      days: r.days,
    };
  });
}
