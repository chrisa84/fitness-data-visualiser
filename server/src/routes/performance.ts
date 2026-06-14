import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { resolveActivityTypeFilter } from '@fitness/shared';
import { getIntensityDistribution, getPerformanceSeries } from '../repositories/performance.js';
import { getRunningDynamics } from '../repositories/runningDynamics.js';
import { badRequest, isoDate } from './validation.js';

const performanceQuery = z.object({
  from: isoDate.default('1970-01-01'),
  to: isoDate.default('9999-12-31'),
  granularity: z.enum(['day', 'week', 'month', 'year']).default('day'),
});

const intensityQuery = z.object({
  from: isoDate.default('1970-01-01'),
  to: isoDate.default('9999-12-31'),
  granularity: z.enum(['day', 'week', 'month', 'year']).default('week'),
  type: z.string().min(1).optional(),
});

// Dynamics are running-specific, so the filter defaults to all running rather
// than all activities.
const dynamicsQuery = z.object({
  from: isoDate.default('1970-01-01'),
  to: isoDate.default('9999-12-31'),
  granularity: z.enum(['day', 'week', 'month', 'year']).default('week'),
  type: z.string().min(1).default('group:running'),
});

export function registerPerformanceRoutes(app: FastifyInstance, db: Database): void {
  app.get('/api/performance', async (request, reply) => {
    const parsed = performanceQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const { from, to, granularity } = parsed.data;
    return { from, to, granularity, points: getPerformanceSeries(db, from, to, granularity) };
  });

  app.get('/api/intensity-distribution', async (request, reply) => {
    const parsed = intensityQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const { from, to, granularity, type } = parsed.data;
    return {
      from,
      to,
      granularity,
      type: type ?? null,
      points: getIntensityDistribution(db, from, to, granularity, resolveActivityTypeFilter(type)),
    };
  });

  app.get('/api/running-dynamics', async (request, reply) => {
    const parsed = dynamicsQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const { from, to, granularity, type } = parsed.data;
    return {
      from,
      to,
      granularity,
      type,
      points: getRunningDynamics(db, from, to, granularity, resolveActivityTypeFilter(type)),
    };
  });
}
