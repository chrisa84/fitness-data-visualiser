import { describe, expect, it } from 'vitest';
import { findCadenceLock, type ActivitySample } from '@fitness/shared';

/** A 30-minute walk sampled every 5 s: 1.3 m/s, cadence 56, HR from `hr(minute)`. */
function walk(hr: (minute: number) => number, cadence = 56): ActivitySample[] {
  const t0 = Date.parse('2025-01-01T10:00:00Z');
  return Array.from({ length: 360 }, (_, i) => ({
    sampleIndex: i,
    timestampUtc: new Date(t0 + i * 5000).toISOString(),
    distanceM: i * 6.5,
    heartRate: hr(i / 12),
    speedMps: 1.3,
    cadence,
    powerW: null, altitudeM: null, lat: null, lon: null, respirationRate: null, groundContactMs: null,
    groundContactBalanceLeft: null, verticalOscillationCm: null, verticalRatioPct: null, strideLengthCm: null,
  }));
}

describe('findCadenceLock', () => {
  it('finds a stretch where HR drops onto the cadence', () => {
    const segs = findCadenceLock(walk((m) => (m >= 10 && m < 15 ? 57 : 92)));
    expect(segs).toHaveLength(1);
    expect(segs[0]!.startIdx).toBe(120);
    expect(segs[0]!.durationS).toBeGreaterThanOrEqual(280);
  });

  it('ignores HR that matches cadence but is not low for the activity', () => {
    expect(findCadenceLock(walk(() => 90, 90))).toEqual([]);
  });

  it('ignores a low reading shorter than a minute', () => {
    expect(findCadenceLock(walk((m) => (m >= 10 && m < 10.5 ? 57 : 92)))).toEqual([]);
  });

  it('ignores low HR that is not on the cadence', () => {
    expect(findCadenceLock(walk((m) => (m >= 10 && m < 15 ? 70 : 92)))).toEqual([]);
  });

  it('returns nothing without timestamps', () => {
    const samples = walk((m) => (m >= 10 && m < 15 ? 57 : 92)).map(({ timestampUtc: _, ...s }) => s);
    expect(findCadenceLock(samples)).toEqual([]);
  });
});
