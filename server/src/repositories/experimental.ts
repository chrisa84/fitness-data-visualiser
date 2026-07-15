import type { Database } from 'better-sqlite3';
import type {
  BestEffortPoint,
  Granularity,
  HrrEfficiencyPoint,
  TempPacePoint,
} from '@fitness/shared';
import { typeFilterClause } from './activities.js';

// EXPERIMENTAL (Phase 20) — backs GET /api/experimental/fitness-trend only.
// To remove: delete this file, routes/experimental.ts, the EXPERIMENTAL block
// in shared/src/index.ts, and the Fitness Trend page. See EXPERIMENTS.md.

// Same validity floors as the Efficiency page: slower than 10:00/km is not a
// steady run; shorter than 3 km is dominated by HR lag.
const MAX_PACE_S_PER_KM = 600;
const MIN_DISTANCE_M = 3000;

// Runs climbing more than this per km are hill/trail efforts whose pace-vs-HR
// relationship isn't comparable to flat running, so they are excluded from the
// %HRR efficiency series (they still count for best efforts and temperature).
const MAX_ELEVATION_M_PER_KM = 25;

// A same-day resting HR is preferred; failing that, the most recent one within
// this many days. Beyond that the run is skipped rather than guessed at.
const RESTING_HR_MAX_AGE_DAYS = 30;

// Max HR is the highest HR observed on any activity in the trailing window —
// self-adjusting as true max HR falls with age, no user input needed.
const MAX_HR_WINDOW_DAYS = 365;

export interface FitnessTrendOptions {
  from: string;
  to: string;
  granularity: Granularity;
  types?: string[];
}

interface RunRow {
  date: string;
  distanceM: number | null;
  durationS: number | null;
  avgSpeedMps: number | null;
  avgHr: number | null;
  elevationGainM: number | null;
  fastestKmS: number | null;
  fastest5kS: number | null;
  tempAvgC: number | null;
}

function isoAddDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the ISO week containing `date` (matches the SQL bucket maps). */
function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const shift = (d.getUTCDay() + 6) % 7;
  return isoAddDays(date, -shift);
}

function bucketKey(date: string, granularity: Granularity): string {
  switch (granularity) {
    case 'day':
      return date;
    case 'week':
      return mondayOf(date);
    case 'month':
      return date.slice(0, 7);
    case 'year':
      return date.slice(0, 4);
  }
}

/**
 * The Fitness Trend series, computed in TS rather than SQL: the %HRR
 * normalisation needs, per run, the same-day (or recent) resting HR and a
 * rolling 12-month max observed HR — a windowed join that is simpler and
 * clearer over a ~thousand-row array than as SQL.
 */
export function getFitnessTrend(
  db: Database,
  opts: FitnessTrendOptions,
): { hrrEf: HrrEfficiencyPoint[]; bestEfforts: BestEffortPoint[]; tempPace: TempPacePoint[] } {
  const params: Record<string, unknown> = { from: opts.from, to: opts.to };
  const typeClause = typeFilterClause(opts.types, params);
  const runs = db
    .prepare(
      `SELECT date(start_time_local) AS date,
              distance_m AS distanceM,
              duration_s AS durationS,
              avg_speed_mps AS avgSpeedMps,
              avg_hr AS avgHr,
              elevation_gain_m AS elevationGainM,
              fastest_km_s AS fastestKmS,
              fastest_5k_s AS fastest5kS,
              temp_avg_c AS tempAvgC
       FROM activity
       WHERE date(start_time_local) BETWEEN @from AND @to
         ${typeClause ? `AND ${typeClause}` : ''}
       ORDER BY date`,
    )
    .all(params) as RunRow[];

  // Resting HR per day, reaching back before `from` so early runs still find a
  // recent value.
  const restingRows = db
    .prepare(
      `SELECT date, resting_hr AS restingHr FROM heart_rate
       WHERE resting_hr IS NOT NULL AND date <= @to AND date >= @minDate
       ORDER BY date`,
    )
    .all({ to: opts.to, minDate: isoAddDays(opts.from, -RESTING_HR_MAX_AGE_DAYS) }) as {
    date: string;
    restingHr: number;
  }[];

  // Max observed HR per day across ALL activity types (a max HR hit on a bike
  // ride is still a max HR), reaching back a full window before `from`.
  const maxHrRows = db
    .prepare(
      `SELECT date(start_time_local) AS date, MAX(max_hr) AS maxHr
       FROM activity
       WHERE max_hr IS NOT NULL AND date(start_time_local) <= @to
         AND date(start_time_local) >= @minDate
       GROUP BY date(start_time_local)
       ORDER BY date`,
    )
    .all({ to: opts.to, minDate: isoAddDays(opts.from, -MAX_HR_WINDOW_DAYS) }) as {
    date: string;
    maxHr: number;
  }[];

  const restingFor = (date: string): number | null => {
    // Latest resting HR on or before `date`, no older than the age cap.
    let best: { date: string; restingHr: number } | null = null;
    for (const row of restingRows) {
      if (row.date > date) break;
      best = row;
    }
    if (!best || best.date < isoAddDays(date, -RESTING_HR_MAX_AGE_DAYS)) return null;
    return best.restingHr;
  };

  const maxHrFor = (date: string): number | null => {
    const windowStart = isoAddDays(date, -MAX_HR_WINDOW_DAYS);
    let max: number | null = null;
    for (const row of maxHrRows) {
      if (row.date > date) break;
      if (row.date >= windowStart && (max == null || row.maxHr > max)) max = row.maxHr;
    }
    return max;
  };

  const efBuckets = new Map<string, { date: string; sum: number; runs: number }>();
  const bestEfforts: BestEffortPoint[] = [];
  const tempPace: TempPacePoint[] = [];

  for (const run of runs) {
    const paceSecPerKm =
      run.distanceM != null && run.distanceM > 0 && run.durationS != null
        ? run.durationS / (run.distanceM / 1000)
        : null;
    const isSteadyRun =
      run.distanceM != null &&
      run.distanceM >= MIN_DISTANCE_M &&
      paceSecPerKm != null &&
      paceSecPerKm <= MAX_PACE_S_PER_KM;

    if (run.fastestKmS != null && run.fastestKmS > 0) {
      bestEfforts.push({ date: run.date, distanceKey: '1k', seconds: run.fastestKmS });
    }
    if (run.fastest5kS != null && run.fastest5kS > 0) {
      bestEfforts.push({ date: run.date, distanceKey: '5k', seconds: run.fastest5kS });
    }
    if (isSteadyRun && run.tempAvgC != null && paceSecPerKm != null) {
      tempPace.push({
        date: run.date,
        tempC: run.tempAvgC,
        paceSecPerKm: Math.round(paceSecPerKm),
        distanceM: run.distanceM as number,
      });
    }

    // %HRR efficiency — steady, roughly flat runs with usable HR context only.
    if (!isSteadyRun || run.avgHr == null || run.avgSpeedMps == null || run.avgSpeedMps <= 0) continue;
    const gainPerKm = (run.elevationGainM ?? 0) / ((run.distanceM as number) / 1000);
    if (gainPerKm > MAX_ELEVATION_M_PER_KM) continue;
    const resting = restingFor(run.date);
    const maxHr = maxHrFor(run.date);
    if (resting == null || maxHr == null || maxHr <= resting + 20 || run.avgHr <= resting) continue;
    const hrrPct = ((run.avgHr - resting) / (maxHr - resting)) * 100;
    if (hrrPct <= 0) continue;
    const hrrEf = (run.avgSpeedMps * 60) / hrrPct;

    const key = bucketKey(run.date, opts.granularity);
    const bucket = efBuckets.get(key);
    if (bucket) {
      bucket.sum += hrrEf;
      bucket.runs += 1;
      if (run.date < bucket.date) bucket.date = run.date;
    } else {
      efBuckets.set(key, { date: run.date, sum: hrrEf, runs: 1 });
    }
  }

  const hrrEf: HrrEfficiencyPoint[] = [...efBuckets.values()]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((b) => ({ date: b.date, hrrEf: Number((b.sum / b.runs).toFixed(3)), runs: b.runs }));

  return { hrrEf, bestEfforts, tempPace };
}
