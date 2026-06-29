import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getIntraday } from '../repositories/intraday.js';
import { badRequest, isoDate } from './validation.js';

const intradayQuery = z.object({
  date: isoDate,
});

export function registerIntradayRoutes(app: FastifyInstance, db: Database): void {
  app.get('/api/intraday', async (request, reply) => {
    const parsed = intradayQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error);
    return getIntraday(db, parsed.data.date);
  });
}
