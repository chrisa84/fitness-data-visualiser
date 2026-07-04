import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import {
  getRouteClusterDetail,
  getRouteClusterForActivity,
  listRouteClusters,
  type ClusterBackfill,
} from '../repositories/routeClusters.js';

export interface RouteClusterRouteOptions {
  db: Database;
  eventsDb: Database;
  backfill: ClusterBackfill;
}

export function registerRouteClusterRoutes(app: FastifyInstance, opts: RouteClusterRouteOptions): void {
  // Serving is what triggers the (lazy, throttled) matching backfill — same
  // pattern as the heatmap; there is no sync-side hook.
  app.get('/api/route-clusters', async () => {
    void opts.backfill.ensureStarted();
    const status = opts.backfill.status();
    return {
      ready: status.processed >= status.total && !status.running,
      clusters: listRouteClusters(opts.db, opts.eventsDb),
    };
  });

  app.get('/api/route-clusters/status', async () => {
    void opts.backfill.ensureStarted();
    return opts.backfill.status();
  });

  // Cluster membership from the activity's side, for the activity page's
  // "similar efforts" section. An unknown activity, a singleton cluster, or
  // a not-yet-matched activity all answer { cluster: null } rather than 404 —
  // the section simply doesn't render.
  app.get('/api/activities/:id/route-cluster', async (request) => {
    void opts.backfill.ensureStarted();
    const status = opts.backfill.status();
    const activityId = (request.params as { id: string }).id;
    return {
      ready: status.processed >= status.total && !status.running,
      cluster: getRouteClusterForActivity(opts.db, opts.eventsDb, activityId),
    };
  });

  app.get('/api/route-clusters/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: 'bad_request', message: 'invalid cluster id' });
    }
    const detail = getRouteClusterDetail(opts.db, opts.eventsDb, id);
    if (!detail) return reply.code(404).send({ error: 'not_found' });
    return detail;
  });
}
