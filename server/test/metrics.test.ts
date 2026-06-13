import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { catalogKeysMatchSql, getMetricSeries } from '../src/repositories/metrics.js';
import { createMetricsDb } from './fixtures.js';

describe('metric catalog', () => {
  it('keeps the shared catalog and server SQL in lockstep', () => {
    expect(catalogKeysMatchSql()).toBe(true);
  });
});

describe('getMetricSeries', () => {
  const seed = {
    heart_rate: [
      { date: '2025-01-01', resting_hr: 50 },
      { date: '2025-01-02', resting_hr: 52 },
    ],
    sleep: [
      { date: '2025-01-01', sleep_score: 80, total_sleep_seconds: 28800 },
      { date: '2025-01-02', sleep_score: 90, total_sleep_seconds: 25200 },
    ],
    training_status: [{ date: '2025-01-02', acute_load: 300, vo2max: 48 }],
    max_metrics: [{ date: '2025-01-03', vo2max: 49 }],
  };

  it('aligns requested metrics by date across tables', () => {
    const db = openDb(createMetricsDb(seed));
    const points = getMetricSeries(db, ['resting_hr', 'sleep_score'], '2025-01-01', '2025-01-31', 'day');
    expect(points).toEqual([
      { date: '2025-01-01', values: { resting_hr: 50, sleep_score: 80 } },
      { date: '2025-01-02', values: { resting_hr: 52, sleep_score: 90 } },
    ]);
  });

  it('includes a date when any requested metric exists there (VO2max fallback table)', () => {
    const db = openDb(createMetricsDb(seed));
    const points = getMetricSeries(db, ['vo2max'], '2025-01-01', '2025-01-31', 'day');
    // training_status has VO2max on the 2nd, max_metrics on the 3rd
    expect(points).toEqual([
      { date: '2025-01-02', values: { vo2max: 48 } },
      { date: '2025-01-03', values: { vo2max: 49 } },
    ]);
  });

  it('converts derived units (sleep seconds → hours)', () => {
    const db = openDb(createMetricsDb(seed));
    const [point] = getMetricSeries(db, ['sleep_hours'], '2025-01-01', '2025-01-01', 'day');
    expect(point?.values.sleep_hours).toBe(8);
  });

  it('averages by month', () => {
    const db = openDb(createMetricsDb(seed));
    const points = getMetricSeries(db, ['resting_hr'], '2025-01-01', '2025-01-31', 'month');
    expect(points).toEqual([{ date: '2025-01-01', values: { resting_hr: 51 } }]);
  });

  it('returns empty for unknown keys', () => {
    const db = openDb(createMetricsDb(seed));
    expect(getMetricSeries(db, ['nonsense'], '2025-01-01', '2025-01-31', 'day')).toEqual([]);
  });
});
