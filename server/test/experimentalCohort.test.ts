import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { getCohortComparison } from '../src/repositories/experimentalCohort.js';
import { createTestDb } from './fixtures.js';

// Two short nights and two long ones, each followed by a resting-HR reading the
// next morning. Short nights are followed by a clearly higher resting HR.
const DAILY = [
  { date: '2025-01-01', total_sleep_seconds: 5 * 3600, sleep_score: 55 },
  { date: '2025-01-02', resting_hr: 60 },
  { date: '2025-01-03', total_sleep_seconds: 5 * 3600, sleep_score: 57 },
  { date: '2025-01-04', resting_hr: 62 },
  { date: '2025-01-05', total_sleep_seconds: 8 * 3600, sleep_score: 85 },
  { date: '2025-01-06', resting_hr: 50 },
  { date: '2025-01-07', total_sleep_seconds: 8 * 3600, sleep_score: 88 },
  { date: '2025-01-08', resting_hr: 52 },
];

function cohort(overrides: Partial<Parameters<typeof getCohortComparison>[1]> = {}) {
  const db = openDb(createTestDb(DAILY));
  return getCohortComparison(db, {
    splitKey: 'sleep_hours',
    splitOp: 'lt',
    splitValue: 6,
    outcomeKey: 'resting_hr',
    lagDays: 1,
    from: '2025-01-01',
    to: '2025-01-31',
    ...overrides,
  });
}

describe('getCohortComparison', () => {
  it('splits the outcome by a threshold on another metric, one day later', () => {
    const result = cohort();
    expect(result.pairedDays).toBe(4);
    expect(result.matched).toMatchObject({ n: 2, mean: 61, min: 60, max: 62 });
    expect(result.other).toMatchObject({ n: 2, mean: 51, min: 50, max: 52 });
    expect(result.differenceMean).toBe(10);
  });

  it('labels each cohort from the metric catalog', () => {
    const result = cohort();
    expect(result.matched.label).toBe('Sleep duration below 6');
    expect(result.other.label).toBe('Sleep duration otherwise');
  });

  it('brackets the difference with a confidence interval', () => {
    const result = cohort();
    // Both groups have sd 1.41 over n=2, so the interval is wide but excludes 0.
    expect(result.differenceLow).toBeLessThan(result.differenceMean!);
    expect(result.differenceHigh).toBeGreaterThan(result.differenceMean!);
    expect(result.differenceLow).toBeGreaterThan(0);
  });

  it('honours the comparison operator', () => {
    const result = cohort({ splitOp: 'gte', splitValue: 6 });
    // The sides swap: long nights are now the matched cohort.
    expect(result.matched).toMatchObject({ n: 2, mean: 51 });
    expect(result.other).toMatchObject({ n: 2, mean: 61 });
    expect(result.differenceMean).toBe(-10);
  });

  it('pairs same-day values when the lag is zero', () => {
    // Sleep and resting HR never share a date in this fixture, so a zero lag
    // finds no pairs at all — proving the lag is really being applied.
    const result = cohort({ lagDays: 0 });
    expect(result.pairedDays).toBe(0);
    expect(result.differenceMean).toBeNull();
  });

  it('reports empty cohorts rather than throwing when nothing matches', () => {
    const result = cohort({ splitValue: 1 });
    expect(result.matched).toMatchObject({ n: 0, mean: null, median: null });
    expect(result.other.n).toBe(4);
    expect(result.differenceMean).toBeNull();
  });
});
