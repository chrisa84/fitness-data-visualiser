import type { Database } from 'better-sqlite3';
import type { SleepNightPoint, SocialJetlagPoint } from '@fitness/shared';

// EXPERIMENTAL (Phase 21) — backs GET /api/experimental/sleep-timing only.
// To remove: delete this file, its route in routes/experimental.ts, the
// sleep-timing types in shared, and the Sleep Timing page. See EXPERIMENTS.md.

/**
 * Nights in the trailing window used for the rolling regularity std dev.
 * Two weeks is long enough to smooth a single late night without blurring a
 * genuine shift in routine.
 */
export const REGULARITY_WINDOW_NIGHTS = 14;

/** Below this many nights in the window, a std dev is noise, so it stays null. */
const MIN_NIGHTS_FOR_REGULARITY = 5;

const MINUTES_PER_DAY = 24 * 60;

/**
 * Clock time as minutes relative to midnight, on a night-centred axis:
 * anything from noon onwards is expressed as negative (23:40 → -20), anything
 * before noon as positive (06:30 → 390).
 *
 * This is the whole trick behind the page. On a plain 0–1439 minute-of-day
 * scale, 23:50 and 00:10 sit at opposite ends, so averaging two nights twenty
 * minutes apart yields midday and the std dev explodes — exactly the metric
 * we are trying to measure.
 *
 * Garmin stores these as UTC instants; `getHours()` renders them in the
 * server's local timezone, matching `localToday()` in `dates.ts` and the
 * documented convention that deployments set `TZ` to the user's timezone.
 * Getting that wrong shifts bedtimes by the offset and, worse, injects a fake
 * 60-minute jump at each DST boundary.
 */
export function nightCentredMinutes(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const minuteOfDay = d.getHours() * 60 + d.getMinutes();
  return minuteOfDay >= MINUTES_PER_DAY / 2 ? minuteOfDay - MINUTES_PER_DAY : minuteOfDay;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Population std dev — we are describing the nights we have, not sampling them. */
function stdDev(values: number[]): number | null {
  const m = mean(values);
  if (m == null || values.length < 2) return null;
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Monday of the ISO week containing `date` — matches every other bucket map. */
function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Saturday/Sunday wake dates are the "weekend" side of the social-jetlag split. */
function isWeekendWake(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

const round = (v: number | null, dp = 1): number | null =>
  v == null ? null : Number(v.toFixed(dp));

interface NightRow {
  date: string;
  sleepStart: string | null;
  sleepEnd: string | null;
  totalSleepSeconds: number | null;
  sleepScore: number | null;
  restingHr: number | null;
  hrv: number | null;
  readiness: number | null;
  bodyBattery: number | null;
}

export interface SleepTimingOptions {
  from: string;
  to: string;
}

/**
 * Sleep timing, regularity and social jetlag.
 *
 * Rows are keyed by Garmin's `sleep.date`, which is the **wake** date, so the
 * health metrics joined on that same date are already the morning-after
 * readings — no lag is applied anywhere here.
 */
export function getSleepTiming(
  db: Database,
  opts: SleepTimingOptions,
): { nights: SleepNightPoint[]; socialJetlag: SocialJetlagPoint[] } {
  const rows = db
    .prepare(
      `SELECT sleep.date                    AS date,
              sleep.sleep_start             AS sleepStart,
              sleep.sleep_end               AS sleepEnd,
              sleep.total_sleep_seconds     AS totalSleepSeconds,
              sleep.sleep_score             AS sleepScore,
              heart_rate.resting_hr         AS restingHr,
              hrv.last_night_avg            AS hrv,
              training_readiness.score      AS readiness,
              daily_summary.body_battery_highest AS bodyBattery
       FROM sleep
       LEFT JOIN heart_rate         ON heart_rate.date = sleep.date
       LEFT JOIN hrv                ON hrv.date = sleep.date
       LEFT JOIN training_readiness ON training_readiness.date = sleep.date
       LEFT JOIN daily_summary      ON daily_summary.date = sleep.date
       WHERE sleep.date BETWEEN @from AND @to
         AND sleep.sleep_start IS NOT NULL
         AND sleep.sleep_end IS NOT NULL
       ORDER BY sleep.date`,
    )
    .all({ from: opts.from, to: opts.to }) as NightRow[];

  // Pass 1: per-night clock values. Midpoint comes from the actual instants
  // (start plus half the elapsed time) rather than averaging two wrapped clock
  // readings, so it stays correct across midnight without special cases.
  const base = rows.map((r) => {
    const startMs = r.sleepStart ? new Date(r.sleepStart).getTime() : NaN;
    const endMs = r.sleepEnd ? new Date(r.sleepEnd).getTime() : NaN;
    const midpointMin =
      Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs
        ? null
        : nightCentredMinutes(new Date(startMs + (endMs - startMs) / 2).toISOString());
    return {
      row: r,
      bedtimeMin: nightCentredMinutes(r.sleepStart),
      wakeMin: nightCentredMinutes(r.sleepEnd),
      midpointMin,
    };
  });

  // Pass 2: rolling regularity over the trailing window of *available* nights.
  // Gaps in wear are skipped rather than zero-filled — a missing night is
  // unknown, not a night spent at midnight.
  const nights: SleepNightPoint[] = base.map((night, i) => {
    const window = base
      .slice(Math.max(0, i - REGULARITY_WINDOW_NIGHTS + 1), i + 1)
      .map((n) => n.midpointMin)
      .filter((v): v is number => v != null);
    const regularityMin = window.length >= MIN_NIGHTS_FOR_REGULARITY ? stdDev(window) : null;

    return {
      date: night.row.date,
      bedtimeMin: round(night.bedtimeMin, 0),
      wakeMin: round(night.wakeMin, 0),
      midpointMin: round(night.midpointMin, 0),
      durationH: round(
        night.row.totalSleepSeconds == null ? null : night.row.totalSleepSeconds / 3600,
        2,
      ),
      sleepScore: night.row.sleepScore,
      regularityMin: round(regularityMin, 0),
      morningRestingHr: night.row.restingHr,
      morningHrv: night.row.hrv,
      morningReadiness: night.row.readiness,
      morningBodyBattery: night.row.bodyBattery,
    };
  });

  // Social jetlag: weekend minus weekday midpoint, per calendar week. Positive
  // means a later body clock at weekends.
  const weeks = new Map<string, { weekday: number[]; weekend: number[] }>();
  for (const night of base) {
    if (night.midpointMin == null) continue;
    const key = mondayOf(night.row.date);
    const bucket = weeks.get(key) ?? { weekday: [], weekend: [] };
    (isWeekendWake(night.row.date) ? bucket.weekend : bucket.weekday).push(night.midpointMin);
    weeks.set(key, bucket);
  }

  const socialJetlag: SocialJetlagPoint[] = [...weeks.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([weekStart, { weekday, weekend }]) => {
      const weekdayMean = mean(weekday);
      const weekendMean = mean(weekend);
      return {
        weekStart,
        weekdayMidpointMin: round(weekdayMean, 0),
        weekendMidpointMin: round(weekendMean, 0),
        jetlagMin:
          weekdayMean == null || weekendMean == null ? null : round(weekendMean - weekdayMean, 0),
        nights: weekday.length + weekend.length,
      };
    });

  return { nights, socialJetlag };
}
