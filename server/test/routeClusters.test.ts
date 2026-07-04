import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { symmetricTrackDistanceM, type LatLon } from '../src/geo.js';
import { createTestDb, type SampleSeed } from './fixtures.js';

describe('symmetricTrackDistanceM', () => {
  const east = (lat: number): LatLon[] => Array.from({ length: 20 }, (_, i) => [lat, -0.1 + i * 0.0002]);

  it('is ~0 for identical tracks', () => {
    expect(symmetricTrackDistanceM(east(51.5), east(51.5))).toBeLessThan(0.001);
  });

  it('reports the lateral offset for parallel tracks', () => {
    // 0.001° latitude ≈ 111 m offset.
    const d = symmetricTrackDistanceM(east(51.5), east(51.501));
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(125);
  });

  it('uses segment distance, not vertex distance, on sparse straight lines', () => {
    // The same straight line described by 2 vs 20 points must still match.
    const sparse: LatLon[] = [east(51.5)[0]!, east(51.5)[19]!];
    expect(symmetricTrackDistanceM(sparse, east(51.5))).toBeLessThan(0.001);
  });

  it('is Infinity when a track is empty', () => {
    expect(symmetricTrackDistanceM([], east(51.5))).toBe(Infinity);
  });
});

describe('route cluster endpoints', () => {
  // A wiggly eastward track: enough deviation that simplification keeps shape.
  function eastTrack(id: string, lonBase: number, latBase = 51.5): SampleSeed[] {
    return Array.from({ length: 40 }, (_, i) => ({
      activity_id: id,
      sample_index: i,
      lat: latBase + (i % 2 === 0 ? 0 : 0.0005),
      lon: lonBase + i * 0.0002,
    }));
  }

  // Same start as eastTrack but heading north — same distance, different route.
  function northTrack(id: string, lonBase: number, latBase = 51.5): SampleSeed[] {
    return Array.from({ length: 40 }, (_, i) => ({
      activity_id: id,
      sample_index: i,
      lat: latBase + i * 0.0002,
      lon: lonBase + (i % 2 === 0 ? 0 : 0.0005),
    }));
  }

  async function waitForMatching(app: ReturnType<typeof buildApp>, expected: number) {
    for (let i = 0; i < 100; i += 1) {
      const res = await app.inject({ url: '/api/route-clusters/status' });
      const status = res.json() as { processed: number; total: number; running: boolean };
      if (status.processed >= expected && !status.running) return status;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('matching backfill did not finish in time');
  }

  function buildFixtureApp() {
    const dbPath = createTestDb(
      [],
      [
        // Two efforts on the same route.
        { activity_id: 'a1', name: 'Park loop', type: 'running', start_time_local: '2025-01-05 08:00:00', distance_m: 5000, duration_s: 1500, avg_hr: 150, avg_speed_mps: 3.33 },
        { activity_id: 'a2', name: 'Park loop', type: 'running', start_time_local: '2025-02-10 08:00:00', distance_m: 5100, duration_s: 1450, avg_hr: 148, avg_speed_mps: 3.52 },
        // Same start and distance, different path — must stay separate.
        { activity_id: 'c1', name: 'North out-and-back', type: 'running', start_time_local: '2025-01-20 08:00:00', distance_m: 5000, duration_s: 1600, avg_hr: 155, avg_speed_mps: 3.1 },
        // Different area entirely.
        { activity_id: 'b1', name: 'Away run', type: 'running', start_time_local: '2025-01-15 08:00:00', distance_m: 5000, duration_s: 1550, avg_hr: 152, avg_speed_mps: 3.2 },
        // No GPS — never clustered.
        { activity_id: 'd1', name: 'Treadmill', type: 'treadmill_running', start_time_local: '2025-01-25 07:00:00', distance_m: 8000 },
      ],
      [],
      [
        ...eastTrack('a1', -0.1),
        ...eastTrack('a2', -0.1),
        ...northTrack('c1', -0.1),
        ...eastTrack('b1', -0.5),
      ],
    );
    return { dbPath, app: buildApp({ dbPath, logger: false }) };
  }

  it('groups same-route efforts and keeps different routes apart', async () => {
    const { app } = buildFixtureApp();
    try {
      await app.inject({ url: '/api/route-clusters' });
      const status = await waitForMatching(app, 4); // 4 activities have GPS tracks
      expect(status.total).toBe(4);

      const res = await app.inject({ url: '/api/route-clusters' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { ready: boolean; clusters: { id: number; name: string; count: number; polyline: string; bestPaceSecPerKm: number }[] };
      expect(body.ready).toBe(true);
      // Only the repeated route surfaces; c1/b1 are singleton clusters.
      expect(body.clusters).toHaveLength(1);
      const cluster = body.clusters[0]!;
      expect(cluster.name).toBe('Park loop');
      expect(cluster.count).toBe(2);
      expect(cluster.polyline.length).toBeGreaterThan(0);
      expect(cluster.bestPaceSecPerKm).toBe(Math.round(1000 / 3.52));

      const detail = await app.inject({ url: `/api/route-clusters/${cluster.id}` });
      expect(detail.statusCode).toBe(200);
      const d = detail.json() as { efforts: { activityId: string; date: string; avgHr: number }[]; distanceM: number };
      expect(d.efforts.map((e) => e.activityId)).toEqual(['a1', 'a2']); // oldest first
      expect(d.efforts[0]!.date).toBe('2025-01-05');
      expect(d.efforts[0]!.avgHr).toBe(150);
    } finally {
      await app.close();
    }
  });

  it('matches a later activity into the existing cluster incrementally', async () => {
    const { dbPath, app } = buildFixtureApp();
    try {
      await app.inject({ url: '/api/route-clusters' });
      await waitForMatching(app, 4);

      // The sync app later mirrors a new run on the same route.
      const Database = (await import('better-sqlite3')).default;
      const raw = new Database(dbPath);
      raw.prepare(
        `INSERT INTO activity (activity_id, name, type, start_time_local, distance_m, duration_s, avg_hr, avg_speed_mps)
         VALUES ('a3', 'Park loop', 'running', '2025-03-01 08:00:00', 4950, 1400, 146, 3.6)`,
      ).run();
      const insert = raw.prepare('INSERT INTO activity_sample (activity_id, sample_index, lat, lon) VALUES (?, ?, ?, ?)');
      for (const s of eastTrack('a3', -0.1)) insert.run(s.activity_id, s.sample_index, s.lat, s.lon);
      raw.close();

      await app.inject({ url: '/api/route-clusters' });
      await waitForMatching(app, 5);
      const body = (await app.inject({ url: '/api/route-clusters' })).json() as {
        clusters: { count: number }[];
      };
      expect(body.clusters).toHaveLength(1);
      expect(body.clusters[0]!.count).toBe(3);
    } finally {
      await app.close();
    }
  });

  it('answers per-activity cluster lookups, null for singletons and no-GPS', async () => {
    const { app } = buildFixtureApp();
    try {
      await app.inject({ url: '/api/activities/a1/route-cluster' }); // kicks the backfill too
      await waitForMatching(app, 4);

      const res = await app.inject({ url: '/api/activities/a1/route-cluster' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        ready: boolean;
        cluster: { id: number; name: string; efforts: { activityId: string }[] } | null;
      };
      expect(body.ready).toBe(true);
      expect(body.cluster?.name).toBe('Park loop');
      expect(body.cluster?.efforts.map((e) => e.activityId)).toEqual(['a1', 'a2']);

      // Singleton cluster (unique route), no GPS, and unknown id all → null.
      for (const id of ['c1', 'd1', 'nope']) {
        const r = await app.inject({ url: `/api/activities/${id}/route-cluster` });
        expect(r.statusCode).toBe(200);
        expect((r.json() as { cluster: unknown }).cluster).toBeNull();
      }
    } finally {
      await app.close();
    }
  });

  it('rejects a bad cluster id and 404s an unknown one', async () => {
    const { app } = buildFixtureApp();
    try {
      expect((await app.inject({ url: '/api/route-clusters/nope' })).statusCode).toBe(400);
      expect((await app.inject({ url: '/api/route-clusters/9999' })).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
