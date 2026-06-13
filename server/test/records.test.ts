import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { getRecords } from '../src/repositories/records.js';
import { createRecordsDb } from './fixtures.js';

const activities = [
  { activity_id: '1', type: 'running', start_time_local: '2025-01-01 08:00:00', distance_m: 10000, duration_s: 3000, fastest_5k_s: 1500, elevation_gain_m: 50 },
  { activity_id: '2', type: 'running', start_time_local: '2025-02-01 08:00:00', distance_m: 21000, duration_s: 6300, fastest_5k_s: 1400, elevation_gain_m: 300 },
  { activity_id: '3', type: 'trail_running', start_time_local: '2025-03-01 08:00:00', distance_m: 30000, duration_s: 12000, elevation_gain_m: 1200 },
  { activity_id: '4', type: 'cycling', start_time_local: '2025-04-01 08:00:00', distance_m: 80000, duration_s: 9000, elevation_gain_m: 500 },
];

describe('getRecords', () => {
  it('computes fastest, longest, and biggest records from activities', () => {
    const db = openDb(createRecordsDb(activities));
    const byKey = Object.fromEntries(getRecords(db).map((r) => [r.key, r]));

    // Fastest 5K is the minimum non-null fastest_5k_s, held by activity 2
    expect(byKey.fastest_5k).toMatchObject({ value: 1400, activityId: '2' });
    // Longest run includes trail_running via the running group → activity 3
    expect(byKey.longest_run).toMatchObject({ value: 30000, activityId: '3' });
    // Longest ride is the cycling activity
    expect(byKey.longest_ride).toMatchObject({ value: 80000, activityId: '4' });
    // Biggest climb across all types → activity 3
    expect(byKey.biggest_climb).toMatchObject({ value: 1200, activityId: '3' });
  });

  it('omits records with no qualifying data', () => {
    const db = openDb(createRecordsDb([{ activity_id: '1', type: 'running', start_time_local: '2025-01-01 08:00:00', distance_m: 5000 }]));
    const keys = getRecords(db).map((r) => r.key);
    expect(keys).toContain('longest_run');
    expect(keys).not.toContain('fastest_5k'); // no fastest_5k_s data
    expect(keys).not.toContain('longest_ride'); // no cycling activity
  });
});
