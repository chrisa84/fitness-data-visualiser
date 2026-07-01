import type { Database } from 'better-sqlite3';
import {
  ACTIVITY_GROUPS,
  resolveActivityTypeFilter,
  type PerformancePoint,
  type RepresentativeRun,
  type TrainingPlanAutofill,
} from '@fitness/shared';
import { getActivityVolume, typeFilterClause } from './activities.js';
import { getPerformanceSeries } from './performance.js';

const LOOKBACK_WEEKS = 12;
const COMPLETE_WEEKS = 6;
const REPRESENTATIVE_LOOKBACK_DAYS = 90;

function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function addDaysUTC(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `date`. */
function weekStartOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dayIndex = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dayIndex);
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
 * Weekly running volume over the last `COMPLETE_WEEKS` calendar weeks that
 * finished *before* today's (necessarily partial) week — zero-filled via a
 * VALUES spine, so a week with no runs counts as 0 rather than being absent
 * from the average entirely.
 */
function getWeeklyVolumeTrend(
  db: Database,
  to: string,
  runningTypes: string[] | undefined,
): { weekStart: string; distanceKm: number; runCount: number }[] {
  const thisWeekStart = weekStartOf(to);
  const params: Record<string, unknown> = {};
  const weekValues = Array.from({ length: COMPLETE_WEEKS }, (_, i) => {
    const key = `w${i}`;
    params[key] = addDaysUTC(thisWeekStart, -7 * (COMPLETE_WEEKS - i));
    return `(@${key})`;
  }).join(', ');
  const typeClause = typeFilterClause(runningTypes, params);

  return db
    .prepare(
      `WITH weeks(week_start) AS (VALUES ${weekValues})
       SELECT weeks.week_start                                          AS weekStart,
              ROUND(COALESCE(SUM(a.distance_m), 0) / 1000.0, 1)         AS distanceKm,
              COUNT(a.activity_id)                                      AS runCount
       FROM weeks
       LEFT JOIN activity a
         ON date(a.start_time_local) >= weeks.week_start
        AND date(a.start_time_local) <  date(weeks.week_start, '+7 days')
        ${typeClause ? `AND ${typeClause}` : ''}
       GROUP BY weeks.week_start
       ORDER BY weeks.week_start`,
    )
    .all(params) as { weekStart: string; distanceKm: number; runCount: number }[];
}

/**
 * Up to 4 real runs from the last ~3 months, each illustrating a different
 * facet of recent fitness (longest, fastest effort, typical, most recent) —
 * deduplicated by activity. This is what "relevant pace" is actually built
 * from now, replacing all-time personal records.
 */
function getRepresentativeRuns(
  db: Database,
  to: string,
  runningTypes: string[] | undefined,
): RepresentativeRun[] {
  const from = daysBefore(to, REPRESENTATIVE_LOOKBACK_DAYS);
  const params: Record<string, unknown> = { from, to };
  const typeClause = typeFilterClause(runningTypes, params);
  const rows = db
    .prepare(
      `SELECT activity_id, date(start_time_local) AS date, distance_m, duration_s
       FROM activity
       WHERE date(start_time_local) BETWEEN @from AND @to
         AND distance_m > 0 AND duration_s > 0
         ${typeClause ? `AND ${typeClause}` : ''}`,
    )
    .all(params) as { activity_id: string; date: string; distance_m: number; duration_s: number }[];
  if (rows.length === 0) return [];

  const runs = rows.map((r) => ({ ...r, paceSecPerKm: r.duration_s / (r.distance_m / 1000) }));
  const used = new Set<string>();
  const picked: RepresentativeRun[] = [];

  const pick = (label: RepresentativeRun['label'], sorted: typeof runs): void => {
    const candidate = sorted.find((r) => !used.has(r.activity_id));
    if (!candidate) return;
    used.add(candidate.activity_id);
    picked.push({
      label,
      date: candidate.date,
      distanceKm: round1(candidate.distance_m / 1000),
      durationS: candidate.duration_s,
      avgPaceSecPerKm: Math.round(candidate.paceSecPerKm),
    });
  };

  pick('longest', [...runs].sort((a, b) => b.distance_m - a.distance_m));
  pick(
    'fastest_effort',
    [...runs].filter((r) => r.distance_m >= 3000).sort((a, b) => a.paceSecPerKm - b.paceSecPerKm),
  );
  const medianDistance = [...runs].sort((a, b) => a.distance_m - b.distance_m)[Math.floor(runs.length / 2)]!
    .distance_m;
  pick(
    'typical',
    [...runs].sort((a, b) => Math.abs(a.distance_m - medianDistance) - Math.abs(b.distance_m - medianDistance)),
  );
  pick('most_recent', [...runs].sort((a, b) => (a.date < b.date ? 1 : -1)));

  return picked.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * A small, fixed-size fitness summary for the plan-generation prompt — the
 * same repository functions behind Volume/Performance, never raw daily
 * rows. Costs zero AI tokens; this is plain SQL.
 */
export function getTrainingPlanAutofill(db: Database, today?: string): TrainingPlanAutofill {
  const to = today ?? new Date().toISOString().slice(0, 10);
  const from = daysBefore(to, LOOKBACK_WEEKS * 7);

  const runningTypes = resolveActivityTypeFilter('group:running');

  const weeklyVolumeTrend = getWeeklyVolumeTrend(db, to, runningTypes);
  const weeklyVolumeAvgKm =
    weeklyVolumeTrend.length > 0
      ? round1(weeklyVolumeTrend.reduce((sum, w) => sum + w.distanceKm, 0) / weeklyVolumeTrend.length)
      : null;

  const longestParams: Record<string, unknown> = { from, to };
  const typeClause = typeFilterClause(runningTypes, longestParams);
  const longest = db
    .prepare(
      `SELECT MAX(distance_m) AS longest FROM activity
       WHERE date(start_time_local) BETWEEN @from AND @to ${typeClause ? `AND ${typeClause}` : ''}`,
    )
    .get(longestParams) as { longest: number | null };

  const perfDaily = getPerformanceSeries(db, from, to, 'day');
  const perfWeekly = getPerformanceSeries(db, from, to, 'week');

  const nonRunningLoad = ACTIVITY_GROUPS.filter((g) => g.key !== 'running').map((group) => {
    const points = getActivityVolume(db, from, to, 'year', group.types);
    const count = points.reduce((sum, p) => sum + p.count, 0);
    const distanceM = points.reduce((sum, p) => sum + p.distanceM, 0);
    const durationS = points.reduce((sum, p) => sum + p.durationS, 0);
    return { group: group.key, count, distanceKm: round1(distanceM / 1000), durationH: round1(durationS / 3600) };
  });

  return {
    weeklyVolumeTrend,
    weeklyVolumeAvgKm,
    longestRecentRunKm: longest.longest != null ? round1(longest.longest / 1000) : null,
    representativeRuns: getRepresentativeRuns(db, to, runningTypes),
    vo2max: lastNonNull(perfDaily, 'vo2max'),
    trainingLoad: {
      acute: lastNonNull(perfDaily, 'acuteLoad'),
      chronic: lastNonNull(perfDaily, 'chronicLoad'),
      acwr: lastNonNull(perfDaily, 'acwr'),
      acwrTrend: perfWeekly.map((p) => p.acwr).filter((v): v is number => typeof v === 'number'),
    },
    readinessScore: lastNonNull(perfDaily, 'readinessScore'),
    racePredictions: {
      race5kS: lastNonNull(perfDaily, 'race5kS'),
      race10kS: lastNonNull(perfDaily, 'race10kS'),
      raceHalfS: lastNonNull(perfDaily, 'raceHalfS'),
      raceFullS: lastNonNull(perfDaily, 'raceFullS'),
    },
    nonRunningLoad,
  };
}
