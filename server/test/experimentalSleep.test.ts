// Clock-time maths is timezone-sensitive by nature (that is the point of the
// feature), so pin the zone before anything reads it. Node resets its cached
// timezone when process.env.TZ is assigned.
process.env.TZ = 'UTC';

import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { getSleepTiming, nightCentredMinutes } from '../src/repositories/experimentalSleep.js';
import { createTestDb } from './fixtures.js';

/** Mon–Fri asleep 23:00–07:00; Sat/Sun asleep 01:00–09:00 (a two-hour lie-in). */
const WEEK = [
  { date: '2025-01-06', sleep_start: '2025-01-05T23:00:00+00:00', sleep_end: '2025-01-06T07:00:00+00:00' },
  { date: '2025-01-07', sleep_start: '2025-01-06T23:00:00+00:00', sleep_end: '2025-01-07T07:00:00+00:00' },
  { date: '2025-01-08', sleep_start: '2025-01-07T23:00:00+00:00', sleep_end: '2025-01-08T07:00:00+00:00' },
  { date: '2025-01-09', sleep_start: '2025-01-08T23:00:00+00:00', sleep_end: '2025-01-09T07:00:00+00:00' },
  { date: '2025-01-10', sleep_start: '2025-01-09T23:00:00+00:00', sleep_end: '2025-01-10T07:00:00+00:00' },
  { date: '2025-01-11', sleep_start: '2025-01-11T01:00:00+00:00', sleep_end: '2025-01-11T09:00:00+00:00' },
  { date: '2025-01-12', sleep_start: '2025-01-12T01:00:00+00:00', sleep_end: '2025-01-12T09:00:00+00:00' },
];

function timing(rows: Record<string, unknown>[]) {
  const db = openDb(createTestDb(rows as never));
  return getSleepTiming(db, { from: '2025-01-01', to: '2025-01-31' });
}

describe('nightCentredMinutes', () => {
  it('puts late evening below midnight and early morning above it', () => {
    // The whole reason this exists: 23:50 and 00:10 must be 20 minutes apart,
    // not 1420 apart as a plain minute-of-day would make them.
    expect(nightCentredMinutes('2025-01-05T23:50:00+00:00')).toBe(-10);
    expect(nightCentredMinutes('2025-01-06T00:10:00+00:00')).toBe(10);
    expect(nightCentredMinutes('2025-01-06T07:30:00+00:00')).toBe(450);
    expect(nightCentredMinutes(null)).toBeNull();
    expect(nightCentredMinutes('not a date')).toBeNull();
  });
});

describe('getSleepTiming', () => {
  it('derives bedtime, wake and midpoint on a night-centred axis', () => {
    const { nights } = timing(WEEK);
    expect(nights).toHaveLength(7);
    expect(nights[0]).toMatchObject({
      date: '2025-01-06',
      bedtimeMin: -60, // 23:00
      wakeMin: 420, // 07:00
      midpointMin: 180, // 03:00
    });
    // Weekend night: asleep 01:00, awake 09:00, midpoint 05:00.
    expect(nights[5]).toMatchObject({ bedtimeMin: 60, wakeMin: 540, midpointMin: 300 });
  });

  it('holds back the rolling regularity until enough nights exist', () => {
    const { nights } = timing(WEEK);
    expect(nights.slice(0, 4).map((n) => n.regularityMin)).toEqual([null, null, null, null]);
    // Five identical weekday nights: perfectly regular.
    expect(nights[4]!.regularityMin).toBe(0);
    // Two weekend lie-ins pull the std dev up.
    expect(nights[6]!.regularityMin).toBe(54);
  });

  it('measures social jetlag as weekend minus weekday midpoint', () => {
    const { socialJetlag } = timing(WEEK);
    expect(socialJetlag).toEqual([
      {
        weekStart: '2025-01-06',
        weekdayMidpointMin: 180,
        weekendMidpointMin: 300,
        jetlagMin: 120,
        nights: 7,
      },
    ]);
  });

  it('leaves jetlag null for a week with nothing on one side of the split', () => {
    const { socialJetlag } = timing(WEEK.slice(0, 3)); // Mon–Wed only
    expect(socialJetlag[0]).toMatchObject({ weekendMidpointMin: null, jetlagMin: null });
  });

  it('joins the same-date health metrics as the morning after', () => {
    // sleep.date is the WAKE date, so same-date metrics need no lag.
    const { nights } = timing([
      {
        ...WEEK[0],
        resting_hr: 48,
        hrv_nightly: 62,
        readiness_score: 77,
        body_battery_highest: 88,
        total_sleep_seconds: 27000,
        sleep_score: 81,
      },
    ]);
    expect(nights[0]).toMatchObject({
      morningRestingHr: 48,
      morningHrv: 62,
      morningReadiness: 77,
      morningBodyBattery: 88,
      durationH: 7.5,
      sleepScore: 81,
    });
  });

  it('skips nights with no recorded start or end', () => {
    const { nights } = timing([
      { date: '2025-01-06', sleep_score: 70, total_sleep_seconds: 25200 },
      WEEK[1] as Record<string, unknown>,
    ]);
    expect(nights.map((n) => n.date)).toEqual(['2025-01-07']);
  });
});
