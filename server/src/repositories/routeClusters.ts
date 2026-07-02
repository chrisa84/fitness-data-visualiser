import type { Database } from 'better-sqlite3';
import type { RouteClusterDetail, RouteClusterEffort, RouteClusterSummary } from '@fitness/shared';
import { decodePolyline, symmetricTrackDistanceM } from '../geo.js';
import { listPendingActivityIds, type GeometryBackfill } from './routeGeometry.js';

/**
 * Repeated-route detection (Phase 19), built on the route_geometry cache.
 * Every activity with a usable track ends up a member of exactly one
 * route_cluster — singleton clusters included, so "processed" is a cheap set
 * difference. Clusters with two or more members are the ones surfaced.
 *
 * A new activity is matched against one representative per cluster (the
 * cluster's first member — stable and cheap; a true medoid recompute isn't
 * worth O(n²) polyline comparisons per insert), after a coarse prefilter on
 * start point and total distance that eliminates almost every pair.
 */

const START_RADIUS_M = 150;
const DISTANCE_TOLERANCE = 0.1;
const MATCH_MEAN_DISTANCE_M = 40;
const M_PER_DEG_LAT = 111_320;

interface GeometryRow {
  polyline: string;
  start_lat: number | null;
  start_lon: number | null;
}

/**
 * Activity ids with a drawable track but no cluster membership yet, oldest
 * first (so the representative of each cluster is its earliest effort).
 */
export function listPendingClusterActivityIds(db: Database, eventsDb: Database): string[] {
  const withTrack = new Set(
    (
      eventsDb
        .prepare('SELECT activity_id AS id FROM route_geometry WHERE point_count >= 2')
        .all() as { id: string }[]
    ).map((r) => r.id),
  );
  const clustered = new Set(
    (eventsDb.prepare('SELECT activity_id AS id FROM route_cluster_member').all() as { id: string }[]).map(
      (r) => r.id,
    ),
  );
  const all = db
    .prepare('SELECT activity_id AS id FROM activity ORDER BY start_time_local ASC')
    .all() as { id: string }[];
  return all.map((r) => r.id).filter((id) => withTrack.has(id) && !clustered.has(id));
}

/**
 * Assigns one activity to an existing cluster (geometric match against the
 * cluster representative) or creates a new singleton cluster for it.
 */
export function matchActivityIntoCluster(db: Database, eventsDb: Database, activityId: string): void {
  const geom = eventsDb
    .prepare(
      'SELECT polyline, start_lat, start_lon FROM route_geometry WHERE activity_id = ? AND point_count >= 2',
    )
    .get(activityId) as GeometryRow | undefined;
  if (!geom || geom.start_lat == null || geom.start_lon == null) return;

  const distanceM =
    (
      db.prepare('SELECT distance_m AS d FROM activity WHERE activity_id = ?').get(activityId) as
        | { d: number | null }
        | undefined
    )?.d ?? null;

  const latDelta = START_RADIUS_M / M_PER_DEG_LAT;
  const lonDelta = START_RADIUS_M / (M_PER_DEG_LAT * Math.max(0.1, Math.cos((geom.start_lat * Math.PI) / 180)));
  const candidates = eventsDb
    .prepare(
      `SELECT id, medoid_activity_id AS medoidId, distance_m AS distanceM FROM route_cluster
       WHERE start_lat BETWEEN ? AND ? AND start_lon BETWEEN ? AND ?`,
    )
    .all(geom.start_lat - latDelta, geom.start_lat + latDelta, geom.start_lon - lonDelta, geom.start_lon + lonDelta) as {
    id: number;
    medoidId: string;
    distanceM: number | null;
  }[];

  const track = decodePolyline(geom.polyline);
  const medoidGeomStmt = eventsDb.prepare(
    'SELECT polyline FROM route_geometry WHERE activity_id = ? AND point_count >= 2',
  );
  const now = new Date().toISOString();

  for (const c of candidates) {
    if ((distanceM == null) !== (c.distanceM == null)) continue;
    if (
      distanceM != null &&
      c.distanceM != null &&
      Math.abs(distanceM - c.distanceM) > DISTANCE_TOLERANCE * Math.max(distanceM, c.distanceM)
    ) {
      continue;
    }
    const medoid = medoidGeomStmt.get(c.medoidId) as { polyline: string } | undefined;
    if (!medoid) continue; // representative's geometry was wiped; skip rather than crash
    if (symmetricTrackDistanceM(track, decodePolyline(medoid.polyline)) <= MATCH_MEAN_DISTANCE_M) {
      eventsDb
        .prepare('INSERT OR IGNORE INTO route_cluster_member (activity_id, cluster_id, created_at) VALUES (?, ?, ?)')
        .run(activityId, c.id, now);
      return;
    }
  }

  const inserted = eventsDb
    .prepare(
      'INSERT INTO route_cluster (medoid_activity_id, start_lat, start_lon, distance_m, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(activityId, geom.start_lat, geom.start_lon, distanceM, now);
  eventsDb
    .prepare('INSERT OR IGNORE INTO route_cluster_member (activity_id, cluster_id, created_at) VALUES (?, ?, ?)')
    .run(activityId, inserted.lastInsertRowid, now);
}

interface MemberMeta {
  id: string;
  name: string | null;
  type: string | null;
  start: string | null;
  distanceM: number | null;
  durationS: number | null;
  avgHr: number | null;
  avgSpeedMps: number | null;
}

function loadMembers(db: Database, eventsDb: Database, clusterId?: number): Map<number, MemberMeta[]> {
  const memberRows = (
    clusterId == null
      ? eventsDb.prepare('SELECT cluster_id AS clusterId, activity_id AS id FROM route_cluster_member').all()
      : eventsDb
          .prepare('SELECT cluster_id AS clusterId, activity_id AS id FROM route_cluster_member WHERE cluster_id = ?')
          .all(clusterId)
  ) as { clusterId: number; id: string }[];
  const meta = new Map(
    (
      db
        .prepare(
          `SELECT activity_id AS id, name, type, start_time_local AS start, distance_m AS distanceM,
                  duration_s AS durationS, avg_hr AS avgHr, avg_speed_mps AS avgSpeedMps
           FROM activity`,
        )
        .all() as MemberMeta[]
    ).map((r) => [r.id, r]),
  );
  const byCluster = new Map<number, MemberMeta[]>();
  for (const m of memberRows) {
    const a = meta.get(m.id);
    if (!a) continue; // activity since deleted upstream
    const list = byCluster.get(m.clusterId) ?? [];
    list.push(a);
    byCluster.set(m.clusterId, list);
  }
  for (const list of byCluster.values()) {
    list.sort((a, b) => ((a.start ?? '') < (b.start ?? '') ? -1 : 1));
  }
  return byCluster;
}

/** Most frequent non-null value; ties resolved by first occurrence. */
function mode(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (v != null) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, n] of counts) {
    if (n > bestCount) {
      best = v;
      bestCount = n;
    }
  }
  return best;
}

function bestPaceSecPerKm(members: MemberMeta[]): number | null {
  const paces = members
    .filter((m) => m.avgSpeedMps != null && m.avgSpeedMps > 0)
    .map((m) => 1000 / m.avgSpeedMps!);
  return paces.length > 0 ? Math.round(Math.min(...paces)) : null;
}

/** Clusters with 2+ efforts, most-ridden first. */
export function listRouteClusters(db: Database, eventsDb: Database): RouteClusterSummary[] {
  const clusters = eventsDb
    .prepare('SELECT id, medoid_activity_id AS medoidId, distance_m AS distanceM FROM route_cluster')
    .all() as { id: number; medoidId: string; distanceM: number | null }[];
  const byCluster = loadMembers(db, eventsDb);
  const polylineStmt = eventsDb.prepare('SELECT polyline FROM route_geometry WHERE activity_id = ?');
  return clusters
    .flatMap((c) => {
      const members = byCluster.get(c.id) ?? [];
      if (members.length < 2) return [];
      const polyline = (polylineStmt.get(c.medoidId) as { polyline: string } | undefined)?.polyline ?? '';
      if (!polyline) return [];
      return [
        {
          id: c.id,
          name: mode(members.map((m) => m.name)),
          type: mode(members.map((m) => m.type)),
          count: members.length,
          distanceM: c.distanceM,
          latestDate: members[members.length - 1]?.start?.slice(0, 10) ?? null,
          bestPaceSecPerKm: bestPaceSecPerKm(members),
          polyline,
        },
      ];
    })
    .sort((a, b) => b.count - a.count);
}

export function getRouteClusterDetail(db: Database, eventsDb: Database, id: number): RouteClusterDetail | null {
  const cluster = eventsDb
    .prepare('SELECT id, medoid_activity_id AS medoidId, distance_m AS distanceM FROM route_cluster WHERE id = ?')
    .get(id) as { id: number; medoidId: string; distanceM: number | null } | undefined;
  if (!cluster) return null;
  const members = loadMembers(db, eventsDb, id).get(id) ?? [];
  const polyline =
    (
      eventsDb.prepare('SELECT polyline FROM route_geometry WHERE activity_id = ?').get(cluster.medoidId) as
        | { polyline: string }
        | undefined
    )?.polyline ?? '';
  const efforts: RouteClusterEffort[] = members.map((m) => ({
    activityId: m.id,
    name: m.name,
    date: (m.start ?? '').slice(0, 10),
    distanceM: m.distanceM,
    durationS: m.durationS,
    avgHr: m.avgHr,
    avgSpeedMps: m.avgSpeedMps,
  }));
  return {
    id: cluster.id,
    name: mode(members.map((m) => m.name)),
    type: mode(members.map((m) => m.type)),
    distanceM: cluster.distanceM,
    polyline,
    efforts,
  };
}

export interface ClusterBackfillStatus {
  total: number;
  processed: number;
  running: boolean;
}

/**
 * Throttled route-matching backfill, same shape as GeometryBackfill: kicked
 * lazily by the route-cluster endpoints, batches with a pause so a small VPS
 * stays responsive, idempotent per activity. Waits for the geometry backfill
 * first — clustering consumes route_geometry rows.
 */
export class ClusterBackfill {
  private current: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly db: Database,
    private readonly eventsDb: Database,
    private readonly geometry: GeometryBackfill,
    private readonly opts: { batchSize?: number; pauseMs?: number; log?: (msg: string) => void } = {},
  ) {}

  status(): ClusterBackfillStatus {
    const total = (
      this.eventsDb.prepare('SELECT COUNT(*) AS n FROM route_geometry WHERE point_count >= 2').get() as { n: number }
    ).n;
    const processed = (
      this.eventsDb.prepare('SELECT COUNT(*) AS n FROM route_cluster_member').get() as { n: number }
    ).n;
    return { total, processed: Math.min(processed, total), running: this.current != null };
  }

  /** Kicks the backfill if it isn't already running. Never rejects. */
  ensureStarted(): Promise<void> {
    if (this.current) return this.current;
    // Steady-state short-circuit, checked synchronously so status() right after
    // this call reports running=false when there is genuinely nothing to do.
    if (
      listPendingActivityIds(this.db, this.eventsDb).length === 0 &&
      listPendingClusterActivityIds(this.db, this.eventsDb).length === 0
    ) {
      return Promise.resolve();
    }
    this.current = this.run().finally(() => {
      this.current = null;
    });
    return this.current;
  }

  stop(): void {
    this.stopped = true;
  }

  private async run(): Promise<void> {
    await this.geometry.ensureStarted();
    if (this.stopped) return;
    const pending = listPendingClusterActivityIds(this.db, this.eventsDb);
    const batchSize = this.opts.batchSize ?? 25;
    const pauseMs = this.opts.pauseMs ?? 150;
    for (let i = 0; i < pending.length; i += batchSize) {
      if (this.stopped) return;
      for (const id of pending.slice(i, i + batchSize)) {
        try {
          matchActivityIntoCluster(this.db, this.eventsDb, id);
        } catch (e) {
          // Skip (and retry next run) rather than letting one bad activity kill the job.
          this.opts.log?.(`route matching failed for activity ${id}: ${(e as Error).message}`);
        }
      }
      if (i + batchSize < pending.length) {
        await new Promise((resolve) => setTimeout(resolve, pauseMs));
      }
    }
  }
}
