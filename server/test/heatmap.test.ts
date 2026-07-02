import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { decodePolyline, encodePolyline, simplifyTrack, type LatLon } from '../src/geo.js';
import { createTestDb } from './fixtures.js';

describe('polyline codec', () => {
  it('round-trips coordinates at 1e-5 precision', () => {
    const points: LatLon[] = [
      [51.50072, -0.12463],
      [51.50109, -0.12301],
      [51.50213, -0.12055],
    ];
    expect(decodePolyline(encodePolyline(points))).toEqual(points);
  });

  it('encodes the empty track as the empty string', () => {
    expect(encodePolyline([])).toBe('');
  });
});

describe('simplifyTrack', () => {
  it('drops collinear points within tolerance', () => {
    const straight: LatLon[] = Array.from({ length: 50 }, (_, i) => [51.5, -0.1 + i * 0.0002]);
    const out = simplifyTrack(straight, 15, 100);
    expect(out.length).toBe(2);
    expect(out[0]).toEqual(straight[0]);
    expect(out[out.length - 1]).toEqual(straight[straight.length - 1]);
  });

  it('keeps corners larger than the tolerance', () => {
    // Right angle: east then north, corner deviation ≫ 15 m.
    const east: LatLon[] = Array.from({ length: 20 }, (_, i) => [51.5, -0.1 + i * 0.0002]);
    const north: LatLon[] = Array.from({ length: 20 }, (_, i) => [51.5 + i * 0.0002, -0.1 + 19 * 0.0002]);
    const out = simplifyTrack([...east, ...north], 15, 100);
    expect(out.length).toBe(3);
  });

  it('enforces the hard point cap', () => {
    // A zigzag where every point deviates beyond tolerance.
    const zigzag: LatLon[] = Array.from({ length: 500 }, (_, i) => [
      51.5 + (i % 2 === 0 ? 0 : 0.001),
      -0.1 + i * 0.0002,
    ]);
    const out = simplifyTrack(zigzag, 15, 100);
    expect(out.length).toBeLessThanOrEqual(100);
  });
});

describe('GET /api/heatmap', () => {
  function gpsTrack(id: string, n: number, lonBase: number) {
    return Array.from({ length: n }, (_, i) => ({
      activity_id: id,
      sample_index: i,
      lat: 51.5 + (i % 2 === 0 ? 0 : 0.0005),
      lon: lonBase + i * 0.0002,
    }));
  }

  async function waitForBackfill(app: ReturnType<typeof buildApp>, total: number) {
    for (let i = 0; i < 100; i += 1) {
      const res = await app.inject({ url: '/api/heatmap/status' });
      const status = res.json() as { processed: number; total: number; running: boolean };
      if (status.processed >= total && !status.running) return status;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('backfill did not finish in time');
  }

  it('backfills geometry lazily and serves encoded tracks with ETag support', async () => {
    const dbPath = createTestDb(
      [],
      [
        { activity_id: 'a1', name: 'Morning run', type: 'running', start_time_local: '2025-03-01 08:00:00', distance_m: 5000 },
        { activity_id: 'a2', name: 'Ride', type: 'cycling', start_time_local: '2025-03-02 09:00:00', distance_m: 20000 },
        { activity_id: 'a3', name: 'Treadmill', type: 'treadmill_running', start_time_local: '2025-03-03 07:00:00', distance_m: 8000 },
      ],
      [],
      [...gpsTrack('a1', 40, -0.1), ...gpsTrack('a2', 40, -0.2)], // a3 has no GPS
    );
    const app = buildApp({ dbPath, logger: false });
    try {
      // First hit kicks the backfill.
      await app.inject({ url: '/api/heatmap' });
      const status = await waitForBackfill(app, 3);
      expect(status.total).toBe(3);
      expect(status.processed).toBe(3); // no-GPS activity recorded too, never reprocessed

      const res = await app.inject({ url: '/api/heatmap' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { ready: boolean; entries: { activityId: string; type: string; date: string; polyline: string }[] };
      expect(body.ready).toBe(true);
      expect(body.entries.map((e) => e.activityId).sort()).toEqual(['a1', 'a2']);
      const a1 = body.entries.find((e) => e.activityId === 'a1')!;
      expect(a1.type).toBe('running');
      expect(a1.date).toBe('2025-03-01');
      const decoded = decodePolyline(a1.polyline);
      expect(decoded.length).toBeGreaterThanOrEqual(2);
      expect(decoded.length).toBeLessThanOrEqual(100);
      expect(decoded[0]![0]).toBeCloseTo(51.5, 4);

      const etag = res.headers.etag as string;
      expect(etag).toBeTruthy();
      const cached = await app.inject({ url: '/api/heatmap', headers: { 'if-none-match': etag } });
      expect(cached.statusCode).toBe(304);
    } finally {
      await app.close();
    }
  });

  it('re-examines a no-GPS activity once samples arrive for it', async () => {
    const dbPath = createTestDb(
      [],
      [{ activity_id: 'a1', type: 'running', start_time_local: '2025-03-01 08:00:00' }],
      [],
      [], // synced without samples at first
    );
    const app = buildApp({ dbPath, logger: false });
    try {
      await app.inject({ url: '/api/heatmap' });
      await waitForBackfill(app, 1);
      let body = (await app.inject({ url: '/api/heatmap' })).json() as { entries: unknown[] };
      expect(body.entries).toHaveLength(0);

      // The sync app later backfills per-sample GPS for the same activity.
      const Database = (await import('better-sqlite3')).default;
      const raw = new Database(dbPath);
      const insert = raw.prepare(
        'INSERT INTO activity_sample (activity_id, sample_index, lat, lon) VALUES (?, ?, ?, ?)',
      );
      for (const s of gpsTrack('a1', 40, -0.1)) insert.run(s.activity_id, s.sample_index, s.lat, s.lon);
      raw.close();

      await app.inject({ url: '/api/heatmap' });
      await waitForBackfill(app, 1);
      body = (await app.inject({ url: '/api/heatmap' })).json() as { entries: unknown[] };
      expect(body.entries).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});
