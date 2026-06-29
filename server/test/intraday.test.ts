import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { getIntraday } from '../src/repositories/intraday.js';
import { createIntradayDb } from './fixtures.js';

const DATE = '2025-06-01';

const db_path = createIntradayDb({
  heartRate: [
    { date: DATE, timestamp_utc: '2025-06-01T06:00:00Z', heart_rate: 55 },
    { date: DATE, timestamp_utc: '2025-06-01T06:01:00Z', heart_rate: 57 },
  ],
  stress: [
    { date: DATE, timestamp_utc: '2025-06-01T06:00:00Z', stress_level: 30 },
    { date: DATE, timestamp_utc: '2025-06-01T06:04:00Z', stress_level: null },
  ],
  steps: [
    { date: DATE, timestamp_utc: '2025-06-01T06:00:00Z', steps: 120, activity_level: 2 },
  ],
  respiration: [
    { date: DATE, timestamp_utc: '2025-06-01T06:00:00Z', breaths_per_min: 14.5 },
  ],
});

describe('getIntraday', () => {
  const db = openDb(db_path);

  it('returns all four series for a date with data', () => {
    const result = getIntraday(db, DATE);
    expect(result.date).toBe(DATE);
    expect(result.heartRate).toHaveLength(2);
    expect(result.stress).toHaveLength(2);
    expect(result.steps).toHaveLength(1);
    expect(result.respiration).toHaveLength(1);
  });

  it('maps heart rate fields correctly', () => {
    const result = getIntraday(db, DATE);
    expect(result.heartRate[0]).toEqual({ timestampUtc: '2025-06-01T06:00:00Z', heartRate: 55 });
    expect(result.heartRate[1]).toEqual({ timestampUtc: '2025-06-01T06:01:00Z', heartRate: 57 });
  });

  it('preserves null stress_level for rest periods', () => {
    const result = getIntraday(db, DATE);
    expect(result.stress[0]).toEqual({ timestampUtc: '2025-06-01T06:00:00Z', stressLevel: 30 });
    expect(result.stress[1]).toEqual({ timestampUtc: '2025-06-01T06:04:00Z', stressLevel: null });
  });

  it('maps steps fields including activity_level', () => {
    const result = getIntraday(db, DATE);
    expect(result.steps[0]).toEqual({ timestampUtc: '2025-06-01T06:00:00Z', steps: 120, activityLevel: 2 });
  });

  it('maps respiration fields correctly', () => {
    const result = getIntraday(db, DATE);
    expect(result.respiration[0]).toEqual({ timestampUtc: '2025-06-01T06:00:00Z', breathsPerMin: 14.5 });
  });

  it('returns empty arrays for a date with no data', () => {
    const result = getIntraday(db, '2020-01-01');
    expect(result.heartRate).toHaveLength(0);
    expect(result.stress).toHaveLength(0);
    expect(result.steps).toHaveLength(0);
    expect(result.respiration).toHaveLength(0);
  });
});
