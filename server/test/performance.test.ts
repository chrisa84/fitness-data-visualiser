import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { getIntensityDistribution, getPerformanceSeries } from '../src/repositories/performance.js';
import { createPerfDb } from './fixtures.js';

describe('getPerformanceSeries', () => {
  it('joins metrics from different tables onto one date spine', () => {
    const db = openDb(
      createPerfDb({
        training_status: [
          { date: '2025-01-01', vo2max: 48, acute_load: 300, chronic_load: 400, acwr: 0.75, training_status_phrase: 'PRODUCTIVE_2' },
        ],
        training_readiness: [
          { date: '2025-01-01', score: 80, hrv_factor_pct: 90, sleep_factor_pct: 70, stress_factor_pct: 60, recovery_time_min: 600 },
        ],
        // race prediction only exists on a different day — the spine must still include it
        race_predictions: [{ date: '2025-01-02', race_5k_s: 1400, race_10k_s: 2900, race_half_s: 6700, race_full_s: 14900 }],
        hill_score: [{ date: '2025-01-01', overall_score: 70, strength_score: 65, hill_endurance_score: 72 }],
      }),
    );
    const points = getPerformanceSeries(db, '2025-01-01', '2025-01-31', 'day');
    expect(points.map((p) => p.date)).toEqual(['2025-01-01', '2025-01-02']);
    expect(points[0]).toMatchObject({
      vo2max: 48,
      acwr: 0.75,
      trainingStatus: 'PRODUCTIVE_2',
      readinessScore: 80,
      hillScore: 70,
      race5kS: null,
    });
    expect(points[1]).toMatchObject({ race5kS: 1400, vo2max: null, trainingStatus: null });
  });

  it('falls back to max_metrics for VO2max when training_status lacks it', () => {
    const db = openDb(
      createPerfDb({
        training_status: [{ date: '2025-01-01', acute_load: 300 }],
        max_metrics: [{ date: '2025-01-01', vo2max: 52, vo2max_precise: 52.3, fitness_age: 30 }],
      }),
    );
    const [point] = getPerformanceSeries(db, '2025-01-01', '2025-01-31', 'day');
    expect(point).toMatchObject({ vo2max: 52, vo2maxPrecise: 52.3 });
  });

  it('averages numerics by month and nulls the status phrase', () => {
    const db = openDb(
      createPerfDb({
        training_status: [
          { date: '2025-01-05', vo2max: 48, acwr: 1.0, training_status_phrase: 'PRODUCTIVE_2' },
          { date: '2025-01-20', vo2max: 50, acwr: 1.4, training_status_phrase: 'STRAINED_3' },
        ],
      }),
    );
    const [point] = getPerformanceSeries(db, '2025-01-01', '2025-01-31', 'month');
    expect(point).toMatchObject({ date: '2025-01-05', vo2max: 49, acwr: 1.2, trainingStatus: null });
  });
});

describe('getIntensityDistribution', () => {
  const seed = {
    activity: [
      { activity_id: '1', type: 'running', start_time_local: '2025-01-05 08:00:00', hr_zone_1_s: 600, hr_zone_2_s: 1200, hr_zone_3_s: 300, hr_zone_4_s: 0, hr_zone_5_s: 0 },
      { activity_id: '2', type: 'trail_running', start_time_local: '2025-01-06 08:00:00', hr_zone_1_s: 300, hr_zone_2_s: 900, hr_zone_3_s: 600, hr_zone_4_s: 120, hr_zone_5_s: 0 },
      { activity_id: '3', type: 'cycling', start_time_local: '2025-01-07 08:00:00', hr_zone_1_s: 1000, hr_zone_2_s: 0, hr_zone_3_s: 0, hr_zone_4_s: 0, hr_zone_5_s: 0 },
      // no zone data — must be excluded
      { activity_id: '4', type: 'running', start_time_local: '2025-01-08 08:00:00', hr_zone_1_s: null, hr_zone_2_s: null, hr_zone_3_s: null, hr_zone_4_s: null, hr_zone_5_s: null },
    ],
  };

  it('sums zone seconds across a group filter, excluding rows without zone data', () => {
    const db = openDb(createPerfDb(seed));
    const points = getIntensityDistribution(db, '1970-01-01', '9999-12-31', 'month', ['running', 'trail_running']);
    expect(points).toEqual([
      { date: '2025-01-05', zone1S: 900, zone2S: 2100, zone3S: 900, zone4S: 120, zone5S: 0 },
    ]);
  });

  it('filters to a single type', () => {
    const db = openDb(createPerfDb(seed));
    const points = getIntensityDistribution(db, '1970-01-01', '9999-12-31', 'year', ['cycling']);
    expect(points).toEqual([{ date: '2025-01-07', zone1S: 1000, zone2S: 0, zone3S: 0, zone4S: 0, zone5S: 0 }]);
  });
});
