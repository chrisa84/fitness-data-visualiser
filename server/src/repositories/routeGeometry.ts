import type { Database } from 'better-sqlite3';
import type { HeatmapEntry } from '@fitness/shared';
import { encodePolyline, simplifyTrack, type LatLon } from '../geo.js';

/**
 * Derived per-activity track geometry, cached in the *writable* events DB
 * (the Garmin DB stays read-only). One row per activity — including no-GPS
 * activities (point_count 0), so "pending" is a cheap set difference against
 * the activity table rather than a scan of activity_sample.
 */

const SIMPLIFY_TOLERANCE_M = 15;
const MAX_POINTS = 100;

/**
 * Activity ids needing geometry work, oldest first: activities with no
 * route_geometry row yet, plus point_count-0 rows whose activity has since
 * gained GPS samples (the sync app backfills per-sample data over time).
 */
export function listPendingActivityIds(db: Database, eventsDb: Database): string[] {
  const done = new Map(
    (
      eventsDb.prepare('SELECT activity_id AS id, point_count AS n FROM route_geometry').all() as {
        id: string;
        n: number;
      }[]
    ).map((r) => [r.id, r.n]),
  );
  const all = db
    .prepare('SELECT activity_id AS id FROM activity ORDER BY start_time_local ASC')
    .all() as { id: string }[];
  const hasGps = db.prepare(
    'SELECT EXISTS(SELECT 1 FROM activity_sample WHERE activity_id = ? AND lat IS NOT NULL) AS e',
  );
  return all
    .map((r) => r.id)
    .filter((id) => {
      const n = done.get(id);
      if (n == null) return true;
      return n === 0 && (hasGps.get(id) as { e: number }).e === 1;
    });
}

/**
 * Reads one activity's GPS track, simplifies it, and stores the encoded
 * polyline. Activities without usable GPS get a point_count-0 row so they are
 * never re-examined.
 */
export function computeAndStoreGeometry(db: Database, eventsDb: Database, activityId: string): void {
  const rows = db
    .prepare(
      `SELECT lat, lon FROM activity_sample
       WHERE activity_id = ? AND lat IS NOT NULL AND lon IS NOT NULL
       ORDER BY sample_index ASC`,
    )
    .all(activityId) as { lat: number; lon: number }[];
  const track: LatLon[] = rows.map((r) => [r.lat, r.lon]);
  const simplified = track.length >= 2 ? simplifyTrack(track, SIMPLIFY_TOLERANCE_M, MAX_POINTS) : [];
  eventsDb
    .prepare(
      `INSERT OR REPLACE INTO route_geometry
         (activity_id, polyline, point_count, start_lat, start_lon, end_lat, end_lon, computed_at)
       VALUES (@activityId, @polyline, @pointCount, @startLat, @startLon, @endLat, @endLon, @computedAt)`,
    )
    .run({
      activityId,
      polyline: simplified.length >= 2 ? encodePolyline(simplified) : '',
      pointCount: simplified.length,
      startLat: simplified[0]?.[0] ?? null,
      startLon: simplified[0]?.[1] ?? null,
      endLat: simplified[simplified.length - 1]?.[0] ?? null,
      endLon: simplified[simplified.length - 1]?.[1] ?? null,
      computedAt: new Date().toISOString(),
    });
}

/** All drawable tracks joined with activity metadata, oldest first. */
export function listHeatmapEntries(db: Database, eventsDb: Database): HeatmapEntry[] {
  const geoms = eventsDb
    .prepare('SELECT activity_id AS id, polyline FROM route_geometry WHERE point_count >= 2')
    .all() as { id: string; polyline: string }[];
  const meta = new Map(
    (
      db
        .prepare('SELECT activity_id AS id, name, type, start_time_local AS start, distance_m AS distanceM FROM activity')
        .all() as { id: string; name: string | null; type: string | null; start: string | null; distanceM: number | null }[]
    ).map((r) => [r.id, r]),
  );
  return geoms
    .flatMap((g) => {
      const m = meta.get(g.id);
      if (!m) return []; // geometry for an activity since deleted upstream
      return [
        {
          activityId: g.id,
          name: m.name,
          type: m.type,
          date: (m.start ?? '').slice(0, 10),
          distanceM: m.distanceM,
          polyline: g.polyline,
        },
      ];
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export interface GeometryBackfillStatus {
  total: number;
  processed: number;
  running: boolean;
}

/**
 * In-process, throttled backfill of route_geometry: batches with a pause in
 * between so the event loop (and the rest of a small shared VPS) stays
 * responsive during the one-off first run. Idempotent per activity — safe to
 * interrupt and restart; steady state is "nothing to do".
 */
export class GeometryBackfill {
  private current: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly db: Database,
    private readonly eventsDb: Database,
    private readonly opts: { batchSize?: number; pauseMs?: number; log?: (msg: string) => void } = {},
  ) {}

  status(): GeometryBackfillStatus {
    const total = (this.db.prepare('SELECT COUNT(*) AS n FROM activity').get() as { n: number }).n;
    const processed = (this.eventsDb.prepare('SELECT COUNT(*) AS n FROM route_geometry').get() as { n: number }).n;
    return { total, processed: Math.min(processed, total), running: this.current != null };
  }

  /** Kicks the backfill if it isn't already running. Never rejects. */
  ensureStarted(): Promise<void> {
    if (this.current) return this.current;
    const pending = listPendingActivityIds(this.db, this.eventsDb);
    if (pending.length === 0) return Promise.resolve();
    this.current = this.run(pending).finally(() => {
      this.current = null;
    });
    return this.current;
  }

  stop(): void {
    this.stopped = true;
  }

  private async run(pending: string[]): Promise<void> {
    const batchSize = this.opts.batchSize ?? 25;
    const pauseMs = this.opts.pauseMs ?? 150;
    for (let i = 0; i < pending.length; i += batchSize) {
      if (this.stopped) return;
      for (const id of pending.slice(i, i + batchSize)) {
        try {
          computeAndStoreGeometry(this.db, this.eventsDb, id);
        } catch (e) {
          // Skip (and retry next run) rather than letting one bad activity kill the job.
          this.opts.log?.(`route geometry failed for activity ${id}: ${(e as Error).message}`);
        }
      }
      if (i + batchSize < pending.length) {
        await new Promise((resolve) => setTimeout(resolve, pauseMs));
      }
    }
  }
}
