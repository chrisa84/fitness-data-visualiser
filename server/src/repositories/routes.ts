import type { Database } from 'better-sqlite3';
import type { SavedRoute, SavedRouteInput } from '@fitness/shared';

function mapRoute(r: Record<string, unknown>): SavedRoute {
  return {
    id: r.id as number,
    name: r.name as string,
    waypoints: JSON.parse(r.waypoints as string),
    snap: Boolean(r.snap),
    totalDistanceM: (r.total_distance_m as number | null) ?? null,
    createdAt: r.created_at as string,
  };
}

export function listRoutes(db: Database): SavedRoute[] {
  return (db.prepare('SELECT * FROM saved_route ORDER BY created_at DESC').all() as Record<string, unknown>[]).map(
    mapRoute,
  );
}

export function getRoute(db: Database, id: number): SavedRoute | null {
  const row = db.prepare('SELECT * FROM saved_route WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? mapRoute(row) : null;
}

export function createRoute(db: Database, input: SavedRouteInput): SavedRoute {
  const info = db
    .prepare(
      `INSERT INTO saved_route (name, waypoints, snap, total_distance_m, created_at)
       VALUES (@name, @waypoints, @snap, @totalDistanceM, @createdAt)`,
    )
    .run({
      name: input.name,
      waypoints: JSON.stringify(input.waypoints),
      snap: input.snap ? 1 : 0,
      totalDistanceM: input.totalDistanceM ?? null,
      createdAt: new Date().toISOString(),
    });
  return getRoute(db, Number(info.lastInsertRowid))!;
}

export function deleteRoute(db: Database, id: number): boolean {
  return db.prepare('DELETE FROM saved_route WHERE id = ?').run(id).changes > 0;
}
