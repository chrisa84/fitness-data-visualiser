import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { resolveActivityTypeFilter } from '@fitness/shared';
import { getFitnessTrend } from '../repositories/experimental.js';
import { badRequest, isoDate } from './validation.js';

// EXPERIMENTAL (Phase 20) — everything under /api/experimental backs the
// Experimental section of the nav and may be removed wholesale. See
// EXPERIMENTS.md for the per-feature removal map.

const fitnessTrendQuery = z.object({
  from: isoDate.default('1970-01-01'),
  to: isoDate.default('9999-12-31'),
  granularity: z.enum(['day', 'week', 'month', 'year']).default('week'),
  type: z.string().min(1).default('group:running'),
});

export function registerExperimentalRoutes(app: FastifyInstance, db: Database): void {
  app.get('/api/experimental/fitness-trend', async (request, reply) => {
    const parsed = fitnessTrendQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const { from, to, granularity, type } = parsed.data;
    return {
      from,
      to,
      granularity,
      type,
      ...getFitnessTrend(db, { from, to, granularity, types: resolveActivityTypeFilter(type) }),
    };
  });
}
