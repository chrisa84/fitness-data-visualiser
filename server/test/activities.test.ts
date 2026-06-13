import { resolveActivityTypeFilter } from '@fitness/shared';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import {
  getActivity,
  getActivityTypes,
  getActivityVolume,
  listActivities,
} from '../src/repositories/activities.js';
import { createTestDb } from './fixtures.js';

const activities = [
  {
    activity_id: '1',
    name: 'Morning Run',
    type: 'running',
    start_time_local: '2025-01-05 08:00:00',
    distance_m: 10000,
    duration_s: 3000,
    avg_hr: 150,
    elevation_gain_m: 100,
  },
  {
    activity_id: '2',
    name: 'Evening Ride',
    type: 'cycling',
    start_time_local: '2025-01-10 18:00:00',
    distance_m: 30000,
    duration_s: 4500,
    avg_hr: 130,
    elevation_gain_m: 250,
  },
  {
    activity_id: '3',
    name: 'Long Run',
    type: 'running',
    start_time_local: '2025-02-01 09:00:00',
    distance_m: 21000,
    duration_s: 6300,
    avg_hr: 155,
    elevation_gain_m: 180,
  },
];

const splits = [
  { activity_id: '1', split_index: 0, split_type: 'INTERVAL_ACTIVE', distance_m: 1000, duration_s: 290, avg_hr: 148 },
  { activity_id: '1', split_index: 1, split_type: 'INTERVAL_ACTIVE', distance_m: 1000, duration_s: 295, avg_hr: 152 },
];

function db() {
  return openDb(createTestDb([], activities, splits));
}

const defaults = {
  from: '1970-01-01',
  to: '9999-12-31',
  sort: 'start_time',
  order: 'desc',
  limit: 50,
  offset: 0,
} as const;

describe('listActivities', () => {
  it('returns newest first by default with total', () => {
    const res = listActivities(db(), { ...defaults });
    expect(res.total).toBe(3);
    expect(res.items.map((i) => i.activityId)).toEqual(['3', '2', '1']);
  });

  it('filters by type and date range', () => {
    const res = listActivities(db(), {
      ...defaults,
      types: ['running'],
      from: '2025-01-01',
      to: '2025-01-31',
    });
    expect(res.items.map((i) => i.activityId)).toEqual(['1']);
  });

  it('matches any type in a multi-type group filter', () => {
    const grouped = openDb(
      createTestDb([], [
        ...activities,
        {
          activity_id: '4',
          name: 'Forest Trail',
          type: 'trail_running',
          start_time_local: '2025-02-05 07:00:00',
          distance_m: 15000,
          duration_s: 5400,
        },
      ]),
    );
    const res = listActivities(grouped, { ...defaults, types: ['running', 'trail_running'] });
    expect(res.items.map((i) => i.activityId).sort()).toEqual(['1', '3', '4']);
  });

  it('searches name case-insensitively', () => {
    const res = listActivities(db(), { ...defaults, q: 'run' });
    expect(res.total).toBe(2);
  });

  it('sorts by distance ascending and paginates', () => {
    const page = listActivities(db(), { ...defaults, sort: 'distance', order: 'asc', limit: 2, offset: 1 });
    expect(page.total).toBe(3);
    expect(page.items.map((i) => i.activityId)).toEqual(['3', '2']);
  });
});

describe('getActivityTypes', () => {
  it('returns counts by type', () => {
    expect(getActivityTypes(db())).toEqual([
      { type: 'running', count: 2 },
      { type: 'cycling', count: 1 },
    ]);
  });
});

describe('getActivity', () => {
  it('returns detail with ordered splits', () => {
    const detail = getActivity(db(), '1');
    expect(detail?.name).toBe('Morning Run');
    expect(detail?.splits.map((s) => s.splitIndex)).toEqual([0, 1]);
    expect(detail?.splits[0]?.splitType).toBe('INTERVAL_ACTIVE');
  });

  it('returns null for unknown id', () => {
    expect(getActivity(db(), 'nope')).toBeNull();
  });
});

describe('getActivityVolume', () => {
  it('aggregates by month', () => {
    const points = getActivityVolume(db(), '1970-01-01', '9999-12-31', 'month');
    expect(points).toEqual([
      { date: '2025-01-05', count: 2, distanceM: 40000, durationS: 7500, elevationGainM: 350 },
      { date: '2025-02-01', count: 1, distanceM: 21000, durationS: 6300, elevationGainM: 180 },
    ]);
  });

  it('filters by type', () => {
    const points = getActivityVolume(db(), '1970-01-01', '9999-12-31', 'year', ['running']);
    expect(points).toEqual([
      { date: '2025-01-05', count: 2, distanceM: 31000, durationS: 9300, elevationGainM: 280 },
    ]);
  });
});

describe('resolveActivityTypeFilter', () => {
  it('returns undefined for empty input', () => {
    expect(resolveActivityTypeFilter(undefined)).toBeUndefined();
    expect(resolveActivityTypeFilter('')).toBeUndefined();
  });

  it('returns a single-element array for an exact type', () => {
    expect(resolveActivityTypeFilter('running')).toEqual(['running']);
  });

  it('expands a group key into its member types', () => {
    expect(resolveActivityTypeFilter('group:running')).toEqual([
      'running',
      'trail_running',
      'treadmill_running',
      'obstacle_run',
    ]);
  });

  it('degrades an unknown group to undefined (no filter)', () => {
    expect(resolveActivityTypeFilter('group:nonsense')).toBeUndefined();
  });
});
