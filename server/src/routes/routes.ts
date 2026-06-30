import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createRoute, deleteRoute, listRoutes } from '../repositories/routes.js';
import { badRequest } from './validation.js';

const waypointSchema = z.object({ lat: z.number(), lng: z.number() });

const routeBody = z.object({
  name: z.string().min(1).max(200),
  waypoints: z.array(waypointSchema).min(2),
  snap: z.boolean(),
  totalDistanceM: z.number().nonnegative().optional(),
});

export function registerRouteRoutes(app: FastifyInstance, eventsDb: Database): void {
  app.get('/api/routes', async () => listRoutes(eventsDb));

  app.post('/api/routes', async (request, reply) => {
    const parsed = routeBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error);
    return reply.code(201).send(createRoute(eventsDb, parsed.data));
  });

  app.delete('/api/routes/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = deleteRoute(eventsDb, Number(id));
    return deleted ? reply.code(204).send() : reply.code(404).send({ error: 'not_found' });
  });
}
