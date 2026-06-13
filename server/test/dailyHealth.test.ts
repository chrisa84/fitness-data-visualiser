import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { getDailyHealth } from '../src/repositories/dailyHealth.js';
import { createTestDb } from './fixtures.js';

const seed = [
  {
    date: '2025-01-01',
    resting_hr: 50,
    total_steps: 10000,
    avg_stress_level: 20,
    sleep_score: 80,
    total_sleep_seconds: 28800,
    deep_sleep_seconds: 7200,
    hrv_nightly: 60,
    hrv_baseline_low: 50,
    hrv_baseline_high: 70,
    bb_charged: 70,
    bb_drained: 60,
  },
  {
    date: '2025-01-02',
    resting_hr: 52,
    total_steps: 12000,
    avg_stress_level: 30,
    sleep_score: 90,
    total_sleep_seconds: 25200,
    hrv_nightly: 64,
  },
  { date: '2025-02-01', resting_hr: 48, total_steps: 8000, avg_stress_level: 25 },
  { date: '2025-02-02' },
];

describe('getDailyHealth', () => {
  it('returns daily rows within range, in order, joining all sources', () => {
    const db = openDb(createTestDb(seed));
    const points = getDailyHealth(db, '2025-01-01', '2025-01-31', 'day');
    expect(points.map((p) => p.date)).toEqual(['2025-01-01', '2025-01-02']);
    expect(points[0]).toMatchObject({
      restingHr: 50,
      totalSteps: 10000,
      avgStressLevel: 20,
      sleepScore: 80,
      sleepTotalS: 28800,
      sleepDeepS: 7200,
      hrvNightly: 60,
      hrvBaselineLow: 50,
      hrvBaselineHigh: 70,
      bodyBatteryCharged: 70,
      bodyBatteryDrained: 60,
    });
    expect(points[1]).toMatchObject({
      sleepScore: 90,
      sleepDeepS: null,
      hrvNightly: 64,
      hrvBaselineLow: null,
      bodyBatteryCharged: null,
    });
  });

  it('aggregates by month with averages, ignoring missing days', () => {
    const db = openDb(createTestDb(seed));
    const points = getDailyHealth(db, '2025-01-01', '2025-12-31', 'month');
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({
      date: '2025-01-01',
      restingHr: 51,
      totalSteps: 11000,
      avgStressLevel: 25,
      sleepScore: 85,
      sleepTotalS: 27000,
      // only Jan 1 has a value; the null on Jan 2 must not drag the average
      sleepDeepS: 7200,
      hrvNightly: 62,
    });
    expect(points[1]).toMatchObject({
      date: '2025-02-01',
      restingHr: 48,
      sleepScore: null,
      hrvNightly: null,
    });
  });

  it('returns an empty array for an empty range', () => {
    const db = openDb(createTestDb(seed));
    expect(getDailyHealth(db, '2030-01-01', '2030-12-31', 'day')).toEqual([]);
  });
});
