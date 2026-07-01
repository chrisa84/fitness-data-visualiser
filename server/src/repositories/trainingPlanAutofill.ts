import type { Database } from 'better-sqlite3';
import { ACTIVITY_GROUPS, resolveActivityTypeFilter, type PerformancePoint, type TrainingPlanAutofill } from '@fitness/shared';
import { getActivityVolume, typeFilterClause } from './activities.js';
import { getPerformanceSeries } from './performance.js';
import { getRecords } from './records.js';

const LOOKBACK_WEEKS = 12;

function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function lastNonNull(points: PerformancePoint[], key: keyof PerformancePoint): number | null {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const v = points[i]![key];
    if (typeof v === 'number') return v;
  }
  return null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * A small, fixed-size fitness summary for the plan-generation prompt — the
 * same repository functions behind Volume/Performance/Records, never raw
 * daily rows. Costs zero AI tokens; this is plain SQL.
 */
export function getTrainingPlanAutofill(db: Database, today?: string): TrainingPlanAutofill {
  const to = today ?? new Date().toISOString().slice(0, 10);
  const from = daysBefore(to, LOOKBACK_WEEKS * 7);

  const runningTypes = resolveActivityTypeFilter('group:running');
  const weeklyVolume = getActivityVolume(db, from, to, 'week', runningTypes).map((p) => ({
    weekStart: p.date,
    distanceKm: round1(p.distanceM / 1000),
    runCount: p.count,
  }));

  const longestParams: Record<string, unknown> = { from, to };
  const typeClause = typeFilterClause(runningTypes, longestParams);
  const longest = db
    .prepare(
      `SELECT MAX(distance_m) AS longest FROM activity
       WHERE date(start_time_local) BETWEEN @from AND @to ${typeClause ? `AND ${typeClause}` : ''}`,
    )
    .get(longestParams) as { longest: number | null };

  const perf = getPerformanceSeries(db, from, to, 'day');

  const nonRunningLoad = ACTIVITY_GROUPS.filter((g) => g.key !== 'running').map((group) => {
    const points = getActivityVolume(db, from, to, 'year', group.types);
    const count = points.reduce((sum, p) => sum + p.count, 0);
    const distanceM = points.reduce((sum, p) => sum + p.distanceM, 0);
    const durationS = points.reduce((sum, p) => sum + p.durationS, 0);
    return { group: group.key, count, distanceKm: round1(distanceM / 1000), durationH: round1(durationS / 3600) };
  });

  return {
    weeklyVolume,
    longestRecentRunKm: longest.longest != null ? round1(longest.longest / 1000) : null,
    records: getRecords(db),
    vo2max: lastNonNull(perf, 'vo2max'),
    trainingLoad: {
      acute: lastNonNull(perf, 'acuteLoad'),
      chronic: lastNonNull(perf, 'chronicLoad'),
      acwr: lastNonNull(perf, 'acwr'),
    },
    readinessScore: lastNonNull(perf, 'readinessScore'),
    racePredictions: {
      race5kS: lastNonNull(perf, 'race5kS'),
      race10kS: lastNonNull(perf, 'race10kS'),
      raceHalfS: lastNonNull(perf, 'raceHalfS'),
      raceFullS: lastNonNull(perf, 'raceFullS'),
    },
    nonRunningLoad,
  };
}
