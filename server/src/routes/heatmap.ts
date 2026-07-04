import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { listHeatmapEntries, type GeometryBackfill } from '../repositories/routeGeometry.js';

export interface HeatmapRouteOptions {
  db: Database;
  eventsDb: Database;
  backfill: GeometryBackfill;
}

export function registerHeatmapRoutes(app: FastifyInstance, opts: HeatmapRouteOptions): void {
  // Serving is what triggers the (lazy, throttled) geometry backfill — there
  // is no sync-side hook; the Garmin DB is a file another app writes.
  app.get('/api/heatmap', async (request, reply) => {
    void opts.backfill.ensureStarted();
    const status = opts.backfill.status();
    // ETag from cheap counts, checked BEFORE building the payload, so a 304
    // costs two COUNT queries instead of assembling every polyline.
    const drawable = (
      opts.eventsDb.prepare('SELECT COUNT(*) AS n FROM route_geometry WHERE point_count >= 2').get() as {
        n: number;
      }
    ).n;
    const etag = `"hm-${status.total}-${status.processed}-${drawable}"`;
    if (request.headers['if-none-match'] === etag) return reply.code(304).send();
    reply.header('etag', etag);
    return { ready: status.processed >= status.total, entries: listHeatmapEntries(opts.db, opts.eventsDb) };
  });

  app.get('/api/heatmap/status', async () => {
    void opts.backfill.ensureStarted();
    return opts.backfill.status();
  });
}
