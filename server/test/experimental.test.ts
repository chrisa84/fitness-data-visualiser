import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { getFitnessTrend } from '../src/repositories/experimental.js';
import { createTestDb } from './fixtures.js';

const RUN_GROUP = ['running', 'trail_running', 'treadmill_running', 'obstacle_run'];

describe('getFitnessTrend', () => {
  // Resting HR 50 on both run days; max HR 190 seen within the trailing year.
  const daily = [
    { date: '2025-01-06', resting_hr: 50 },
    { date: '2025-01-13', resting_hr: 50 },
  ];
  const activities = [
    // Old hard session that establishes the rolling max HR window.
    {
      activity_id: 'maxhr',
      type: 'running',
      start_time_local: '2024-09-01 08:00:00',
      distance_m: 5000,
      duration_s: 1500,
      avg_hr: 175,
      max_hr: 190,
      avg_speed_mps: 3.33,
    },
    // Steady flat run: HRR% = (150-50)/(190-50) = 71.43; EF = 3.0*60/71.43 = 2.52.
    {
      activity_id: 'a',
      type: 'running',
      start_time_local: '2025-01-06 08:00:00',
      distance_m: 9000,
      duration_s: 3000,
      avg_hr: 150,
      max_hr: 165,
      avg_speed_mps: 3.0,
      elevation_gain_m: 40,
      fastest_km_s: 250,
      fastest_5k_s: 1400,
      temp_avg_c: 12,
    },
    // Hilly run: excluded from %HRR EF (56 m/km), still counts for temp/pace.
    {
      activity_id: 'hilly',
      type: 'running',
      start_time_local: '2025-01-13 08:00:00',
      distance_m: 9000,
      duration_s: 3600,
      avg_hr: 155,
      max_hr: 170,
      avg_speed_mps: 2.5,
      elevation_gain_m: 500,
      temp_avg_c: 8,
    },
    // Cycling: excluded by the type filter entirely.
    {
      activity_id: 'ride',
      type: 'cycling',
      start_time_local: '2025-01-07 08:00:00',
      distance_m: 30000,
      duration_s: 3600,
      avg_hr: 140,
      max_hr: 175,
      avg_speed_mps: 8.3,
      temp_avg_c: 10,
    },
  ];

  it('computes %HRR EF only for steady flat runs with HR context', () => {
    const db = openDb(createTestDb(daily, activities));
    const trend = getFitnessTrend(db, {
      from: '2025-01-01',
      to: '2025-01-31',
      granularity: 'week',
      types: RUN_GROUP,
    });
    expect(trend.hrrEf).toHaveLength(1);
    expect(trend.hrrEf[0]!.date).toBe('2025-01-06');
    expect(trend.hrrEf[0]!.runs).toBe(1);
    expect(trend.hrrEf[0]!.hrrEf).toBeCloseTo((3.0 * 60) / (((150 - 50) / (190 - 50)) * 100), 2);
  });

  it('returns best-split efforts and temperature/pace points', () => {
    const db = openDb(createTestDb(daily, activities));
    const trend = getFitnessTrend(db, {
      from: '2025-01-01',
      to: '2025-01-31',
      granularity: 'week',
      types: RUN_GROUP,
    });
    expect(trend.bestEfforts).toEqual([
      { date: '2025-01-06', distanceKey: '1k', seconds: 250 },
      { date: '2025-01-06', distanceKey: '5k', seconds: 1400 },
    ]);
    // Both runs qualify for temp/pace (the hilly one is only excluded from EF);
    // the ride is filtered out by type.
    expect(trend.tempPace.map((p) => p.date)).toEqual(['2025-01-06', '2025-01-13']);
    expect(trend.tempPace[0]).toEqual({
      date: '2025-01-06',
      tempC: 12,
      paceSecPerKm: 333,
      distanceM: 9000,
    });
  });

  it('skips runs with no recent resting HR instead of guessing', () => {
    const db = openDb(
      createTestDb(
        [{ date: '2024-10-01', resting_hr: 50 }], // >30 days before the run
        activities,
      ),
    );
    const trend = getFitnessTrend(db, {
      from: '2025-01-01',
      to: '2025-01-31',
      granularity: 'week',
      types: RUN_GROUP,
    });
    expect(trend.hrrEf).toHaveLength(0);
  });
});
