import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { getEfficiencySeries } from '../src/repositories/efficiency.js';
import { createTestDb } from './fixtures.js';

const RUN_GROUP = ['running', 'trail_running', 'treadmill_running', 'obstacle_run'];

describe('getEfficiencySeries', () => {
  const activities = [
    // In-band run (HR 150): EF = 3.0*60/150 = 1.2; pace = 3000 / (9000/1000) ... use 3 m/s
    {
      activity_id: 'a',
      type: 'running',
      start_time_local: '2025-01-06 08:00:00',
      distance_m: 9000,
      duration_s: 3000,
      avg_hr: 150,
      avg_speed_mps: 3.0,
    },
    // Out-of-band run (HR 170): contributes to EF but not the band pace.
    {
      activity_id: 'b',
      type: 'running',
      start_time_local: '2025-01-07 08:00:00',
      distance_m: 5000,
      duration_s: 1500,
      avg_hr: 170,
      avg_speed_mps: 3.33,
    },
    // Cycling: excluded by the type filter.
    { activity_id: 'c', type: 'cycling', start_time_local: '2025-01-08 08:00:00', avg_hr: 150, avg_speed_mps: 8 },
  ];

  it('computes EF over all runs and band pace only for in-band runs', () => {
    const db = openDb(createTestDb([], activities));
    const points = getEfficiencySeries(db, {
      from: '2025-01-01',
      to: '2025-01-31',
      granularity: 'week',
      types: RUN_GROUP,
      hrMin: 145,
      hrMax: 155,
    });
    expect(points).toHaveLength(1);
    const p = points[0]!;
    // EF averages a (1.2) and b (3.33*60/170 ≈ 1.175) → ~1.19
    expect(p.efficiencyFactor).toBeCloseTo(1.19, 1);
    // Only run a is in the 145–155 band: pace = 3000 / 9 = 333.3 s/km
    expect(p.paceInBandS).toBeCloseTo(333.3, 0);
    expect(p.runs).toBe(2);
    expect(p.runsInBand).toBe(1);
  });
});
