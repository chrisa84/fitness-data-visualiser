import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { getTrainingLoadStrain } from '../src/repositories/trainingLoad.js';
import { createTestDb } from './fixtures.js';

describe('getTrainingLoadStrain', () => {
  // One ISO week (Mon 2025-01-06 .. Sun 2025-01-12). Loads on Mon/Wed/Fri, with a
  // zero-load Sunday so the spine spans the full 7 days (rest days count as 0).
  const activities = [
    { activity_id: 'a', type: 'running', start_time_local: '2025-01-06 08:00:00', training_load: 100 },
    { activity_id: 'b', type: 'running', start_time_local: '2025-01-08 08:00:00', training_load: 50 },
    { activity_id: 'c', type: 'running', start_time_local: '2025-01-10 08:00:00', training_load: 150 },
    { activity_id: 'd', type: 'running', start_time_local: '2025-01-12 08:00:00', training_load: 0 },
  ];

  it('computes weekly load, monotony and strain with rest days as zero', () => {
    const db = openDb(createTestDb([], activities));
    const points = getTrainingLoadStrain(db, '2025-01-01', '2025-01-31');
    expect(points).toHaveLength(1);
    const p = points[0]!;
    expect(p.days).toBe(7); // Mon..Sun, rest days included
    expect(p.weeklyLoad).toBe(300);
    expect(p.meanLoad).toBe(42.9); // 300 / 7
    // sd ≈ 56.24 → monotony ≈ 0.76, strain ≈ 300 * 0.762 ≈ 229
    expect(p.monotony).toBeCloseTo(0.76, 2);
    expect(p.strain).toBe(229);
  });
});
