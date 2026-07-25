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
import { activityIdsWithAllTags, tagIdsForActivities } from '../repositories/tags.js';
import { badRequest, isoDate } from './validation.js';

/** `tags=1,2` → `[1, 2]`. Non-numeric entries are dropped, not rejected. */
const tagIdList = z
  .string()
  .transform((s) => s.split(',').map((v) => Number(v.trim())).filter((n) => Number.isInteger(n) && n > 0));

const listQuery = z.object({
  from: isoDate.default('1970-01-01'),
  to: isoDate.default('9999-12-31'),
  type: z.string().min(1).optional(),
  q: z.string().min(1).optional(),
  minKm: z.coerce.number().min(0).optional(),
  maxKm: z.coerce.number().min(0).optional(),
  tags: tagIdList.optional(),
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

export interface ActivityRouteDeps {
  db: Database;
  /** Writable DB — only used to resolve and overlay the user's own tags. */
  eventsDb: Database;
}

export function registerActivityRoutes(app: FastifyInstance, { db, eventsDb }: ActivityRouteDeps): void {
  app.get('/api/activities', async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const { type, tags, ...rest } = parsed.data;

    // Tags live in the other database, so they are resolved to a concrete id
    // set first and passed in as a filter — no cross-database join. An empty
    // result here is a real "nothing matched", which listActivities honours.
    const activityIds = tags && tags.length > 0 ? activityIdsWithAllTags(eventsDb, tags) : undefined;

    const page = listActivities(db, {
      ...rest,
      activityIds,
      types: resolveActivityTypeFilter(type),
    });

    const byActivity = tagIdsForActivities(eventsDb, page.items.map((a) => a.activityId));
    return {
      ...page,
      items: page.items.map((a) => ({ ...a, tagIds: byActivity[a.activityId] ?? [] })),
    };
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
