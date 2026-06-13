import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { EVENT_TYPES, METRIC_KEYS } from '@fitness/shared';
import {
  createEvent,
  deleteEvent,
  listEvents,
  updateEvent,
} from '../repositories/events.js';
import { getMetricSeries } from '../repositories/metrics.js';
import { getRecords } from '../repositories/records.js';
import { badRequest, isoDate } from './validation.js';

const metricsQuery = z.object({
  keys: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(METRIC_KEYS as [string, ...string[]])).min(1).max(8)),
  from: isoDate.default('1970-01-01'),
  to: isoDate.default('9999-12-31'),
  granularity: z.enum(['day', 'week', 'month', 'year']).default('day'),
});

const eventsQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

const eventBody = z
  .object({
    date: isoDate,
    endDate: isoDate.nullish(),
    type: z.enum(EVENT_TYPES),
    label: z.string().min(1).max(200),
    notes: z.string().max(2000).nullish(),
  })
  .refine((e) => !e.endDate || e.endDate >= e.date, {
    message: 'endDate must be on or after date',
    path: ['endDate'],
  });

/** Read-only analysis routes (metrics, records) against the Garmin database. */
export function registerAnalysisRoutes(app: FastifyInstance, db: Database): void {
  app.get('/api/metrics', async (request, reply) => {
    const parsed = metricsQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const { keys, from, to, granularity } = parsed.data;
    return { from, to, granularity, keys, points: getMetricSeries(db, keys, from, to, granularity) };
  });

  app.get('/api/records', async () => getRecords(db));
}

/** CRUD routes for visualiser-owned events, backed by the writable database. */
export function registerEventRoutes(app: FastifyInstance, eventsDb: Database): void {
  app.get('/api/events', async (request, reply) => {
    const parsed = eventsQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error);
    return listEvents(eventsDb, parsed.data.from, parsed.data.to);
  });

  app.post('/api/events', async (request, reply) => {
    const parsed = eventBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error);
    return reply.code(201).send(createEvent(eventsDb, parsed.data));
  });

  app.patch('/api/events/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: 'bad_request', message: 'invalid event id' });
    }
    const parsed = eventBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const updated = updateEvent(eventsDb, id, parsed.data);
    if (!updated) return reply.code(404).send({ error: 'not_found', message: `no event ${id}` });
    return updated;
  });

  app.delete('/api/events/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deleteEvent(eventsDb, id)) {
      return reply.code(404).send({ error: 'not_found', message: `no event ${id}` });
    }
    return { deleted: id };
  });
}
