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
    const entries = listHeatmapEntries(opts.db, opts.eventsDb);
    const etag = `"hm-${status.total}-${status.processed}-${entries.length}"`;
    if (request.headers['if-none-match'] === etag) return reply.code(304).send();
    reply.header('etag', etag);
    return { ready: status.processed >= status.total, entries };
  });

  app.get('/api/heatmap/status', async () => {
    void opts.backfill.ensureStarted();
    return opts.backfill.status();
  });
}
