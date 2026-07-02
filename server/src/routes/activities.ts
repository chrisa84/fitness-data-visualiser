import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ACTIVITY_SORT_KEYS, resolveActivityTypeFilter } from '@fitness/shared';
import {
  getActivity,
  getActivitySamples,
  getActivityTypes,
  getActivityVolume,
  listActivities,
} from '../repositories/activities.js';
import { badRequest, isoDate } from './validation.js';

const listQuery = z.object({
  from: isoDate.default('1970-01-01'),
  to: isoDate.default('9999-12-31'),
  type: z.string().min(1).optional(),
  q: z.string().min(1).optional(),
  minKm: z.coerce.number().min(0).optional(),
  maxKm: z.coerce.number().min(0).optional(),
  sort: z.enum(ACTIVITY_SORT_KEYS).default('start_time'),
  order: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const volumeQuery = z.object({
  from: isoDate.default('1970-01-01'),
  to: isoDate.default('9999-12-31'),
  granularity: z.enum(['day', 'week', 'month', 'year']).default('week'),
  type: z.string().min(1).optional(),
});

export function registerActivityRoutes(app: FastifyInstance, db: Database): void {
  app.get('/api/activities', async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const { type, ...rest } = parsed.data;
    return listActivities(db, { ...rest, types: resolveActivityTypeFilter(type) });
  });

  app.get('/api/activity-types', async () => getActivityTypes(db));

  app.get('/api/activities/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const activity = getActivity(db, id);
    if (!activity) {
      return reply.code(404).send({ error: 'not_found', message: `no activity ${id}` });
    }
    return activity;
  });

  app.get('/api/activities/:id/samples', async (request, reply) => {
    const { id } = request.params as { id: string };
    const samples = getActivitySamples(db, id);
    if (samples.length === 0 && !getActivity(db, id)) {
      return reply.code(404).send({ error: 'not_found', message: `no activity ${id}` });
    }
    return samples;
  });

  app.get('/api/activity-volume', async (request, reply) => {
    const parsed = volumeQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const { from, to, granularity, type } = parsed.data;
    return {
      from,
      to,
      granularity,
      type: type ?? null,
      points: getActivityVolume(db, from, to, granularity, resolveActivityTypeFilter(type)),
    };
  });
}
