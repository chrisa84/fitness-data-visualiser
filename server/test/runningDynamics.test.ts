import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { getRunningDynamics } from '../src/repositories/runningDynamics.js';
import { createTestDb } from './fixtures.js';

const RUN_GROUP = ['running', 'trail_running', 'treadmill_running', 'obstacle_run'];

describe('getRunningDynamics', () => {
  const activities = [
    {
      activity_id: 'a',
      type: 'running',
      start_time_local: '2025-01-06 07:00:00',
      ground_contact_ms: 240,
      vertical_oscillation_cm: 8.0,
      stride_length_cm: 120,
      avg_cadence: 170,
      ground_contact_balance_left: 49.5,
    },
    {
      activity_id: 'b',
      type: 'trail_running',
      start_time_local: '2025-01-07 07:00:00',
      ground_contact_ms: 260,
      vertical_oscillation_cm: 9.0,
      stride_length_cm: 110,
      avg_cadence: 168,
    },
    { activity_id: 'c', type: 'cycling', start_time_local: '2025-01-08 07:00:00', avg_power: 200 },
  ];

  it('averages dynamics over running activities per bucket', () => {
    const db = openDb(createTestDb([], activities));
    const points = getRunningDynamics(db, '2025-01-01', '2025-01-31', 'week', RUN_GROUP);
    expect(points).toHaveLength(1);
    expect(points[0]!.groundContactMs).toBe(250); // (240 + 260) / 2
    // Only activity a recorded balance; the average ignores the null.
    expect(points[0]!.balanceLeftPct).toBe(49.5);
  });

  it('honours the type filter (cycling and trail excluded)', () => {
    const db = openDb(createTestDb([], activities));
    const points = getRunningDynamics(db, '2025-01-01', '2025-01-31', 'month', ['running']);
    expect(points[0]!.groundContactMs).toBe(240); // only activity a
  });
});
