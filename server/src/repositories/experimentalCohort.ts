import type { Database } from 'better-sqlite3';
import type { CohortOp, CohortResponse, CohortStats } from '@fitness/shared';
import { COHORT_OP_LABELS, metricMeta } from '@fitness/shared';
import { getMetricSeries } from './metrics.js';

// EXPERIMENTAL (Phase 21) — backs GET /api/experimental/cohort only.
// To remove: delete this file, its route in routes/experimental.ts, the cohort
// types in shared, and the Cohort page. See EXPERIMENTS.md.

/**
 * Splits one daily metric by a threshold condition on another and compares the
 * two groups — "resting HR the morning after a night under 6 hours, versus
 * every other morning".
 *
 * Built entirely on `getMetricSeries`, so every catalog metric works on both
 * sides for free and no new SQL exists to drift. The arithmetic runs over a
 * few thousand daily rows in TS, which is clearer than expressing a lagged
 * self-join and a std dev in SQLite.
 */

/**
 * Normal approximation to the 95% interval. With the hundreds of days these
 * comparisons run over, the t correction is under a percent — and the honest
 * limitation here is that this is observational data, not the third decimal
 * place of a critical value.
 */
const Z_95 = 1.96;

const MS_PER_DAY = 86_400_000;

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  return new Date(d.getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function compare(value: number, op: CohortOp, threshold: number): boolean {
  switch (op) {
    case 'lt':
      return value < threshold;
    case 'lte':
      return value <= threshold;
    case 'gt':
      return value > threshold;
    case 'gte':
      return value >= threshold;
  }
}

const round = (v: number | null, dp = 2): number | null => (v == null ? null : Number(v.toFixed(dp)));

/** Linear-interpolation-free percentile: nearest rank on the sorted values. */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[index]!;
}

function summarize(label: string, values: number[]): CohortStats {
  const sorted = [...values].sort((a, b) => a - b);
  const n = values.length;
  const mean = n === 0 ? null : values.reduce((a, b) => a + b, 0) / n;
  const sd =
    mean == null || n < 2
      ? null
      : Math.sqrt(values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1));
  return {
    label,
    n,
    mean: round(mean),
    sd: round(sd),
    median: round(percentile(sorted, 0.5)),
    p25: round(percentile(sorted, 0.25)),
    p75: round(percentile(sorted, 0.75)),
    min: round(sorted[0] ?? null),
    max: round(sorted[sorted.length - 1] ?? null),
  };
}

export interface CohortOptions {
  splitKey: string;
  splitOp: CohortOp;
  splitValue: number;
  outcomeKey: string;
  lagDays: number;
  from: string;
  to: string;
}

export function getCohortComparison(db: Database, opts: CohortOptions): CohortResponse {
  const { splitKey, splitOp, splitValue, outcomeKey, lagDays, from, to } = opts;

  const splitSeries = getMetricSeries(db, [splitKey], from, to, 'day');
  // The outcome window is shifted by the lag so a split day at the very end of
  // the range can still find its follow-up day.
  const outcomeSeries = getMetricSeries(
    db,
    [outcomeKey],
    shiftDate(from, lagDays),
    shiftDate(to, lagDays),
    'day',
  );

  const outcomeByDate = new Map<string, number>();
  for (const point of outcomeSeries) {
    const value = point.values[outcomeKey];
    if (typeof value === 'number') outcomeByDate.set(point.date, value);
  }

  const matchedValues: number[] = [];
  const otherValues: number[] = [];
  for (const point of splitSeries) {
    const splitPointValue = point.values[splitKey];
    if (typeof splitPointValue !== 'number') continue;
    const outcome = outcomeByDate.get(shiftDate(point.date, lagDays));
    if (outcome == null) continue;
    (compare(splitPointValue, splitOp, splitValue) ? matchedValues : otherValues).push(outcome);
  }

  const splitLabel = metricMeta(splitKey)?.label ?? splitKey;
  const opLabel = COHORT_OP_LABELS[splitOp];
  const matched = summarize(`${splitLabel} ${opLabel} ${splitValue}`, matchedValues);
  const other = summarize(`${splitLabel} otherwise`, otherValues);

  // Welch: the two groups have no reason to share a variance (a handful of bad
  // nights are far more scattered than the many ordinary ones).
  let differenceMean: number | null = null;
  let differenceLow: number | null = null;
  let differenceHigh: number | null = null;
  if (matched.mean != null && other.mean != null && matched.sd != null && other.sd != null) {
    const diff = matched.mean - other.mean;
    const standardError = Math.sqrt(
      matched.sd ** 2 / matched.n + other.sd ** 2 / other.n,
    );
    differenceMean = round(diff);
    differenceLow = round(diff - Z_95 * standardError);
    differenceHigh = round(diff + Z_95 * standardError);
  }

  return {
    from,
    to,
    splitKey,
    splitOp,
    splitValue,
    outcomeKey,
    lagDays,
    pairedDays: matchedValues.length + otherValues.length,
    matched,
    other,
    differenceMean,
    differenceLow,
    differenceHigh,
  };
}
