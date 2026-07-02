import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { resolveActivityTypeFilter } from '@fitness/shared';
import { getEfficiencySeries } from '../repositories/efficiency.js';
import { getIntensityDistribution, getPerformanceSeries } from '../repositories/performance.js';
import { getFormVsPace, getRunningDynamics } from '../repositories/runningDynamics.js';
import { getTrainingLoadStrain } from '../repositories/trainingLoad.js';
import { badRequest, isoDate } from './validation.js';

const performanceQuery = z.object({
  from: isoDate.default('1970-01-01'),
  to: isoDate.default('9999-12-31'),
  granularity: z.enum(['day', 'week', 'month', 'year']).default('day'),
});

const loadQuery = z.object({
  from: isoDate.default('1970-01-01'),
  to: isoDate.default('9999-12-31'),
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

const formVsPaceQuery = z.object({
  from: isoDate.default('1970-01-01'),
  to: isoDate.default('9999-12-31'),
  type: z.string().min(1).default('group:running'),
});

const efficiencyQuery = z
  .object({
    from: isoDate.default('1970-01-01'),
    to: isoDate.default('9999-12-31'),
    granularity: z.enum(['day', 'week', 'month', 'year']).default('week'),
    type: z.string().min(1).default('group:running'),
    hrMin: z.coerce.number().int().min(60).max(220).default(145),
    hrMax: z.coerce.number().int().min(60).max(220).default(155),
  })
  .refine((q) => q.hrMin < q.hrMax, { message: 'hrMin must be below hrMax', path: ['hrMin'] });

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

  app.get('/api/form-vs-pace', async (request, reply) => {
    const parsed = formVsPaceQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const { from, to, type } = parsed.data;
    return {
      from,
      to,
      type,
      points: getFormVsPace(db, from, to, resolveActivityTypeFilter(type)),
    };
  });

  app.get('/api/training-load', async (request, reply) => {
    const parsed = loadQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const { from, to } = parsed.data;
    return { from, to, points: getTrainingLoadStrain(db, from, to) };
  });

  app.get('/api/efficiency', async (request, reply) => {
    const parsed = efficiencyQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const { from, to, granularity, type, hrMin, hrMax } = parsed.data;
    return {
      from,
      to,
      granularity,
      type,
      hrMin,
      hrMax,
      points: getEfficiencySeries(db, {
        from,
        to,
        granularity,
        types: resolveActivityTypeFilter(type),
        hrMin,
        hrMax,
      }),
    };
  });
}
