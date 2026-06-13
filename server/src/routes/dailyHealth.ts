import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DailyHealthResponse } from '@fitness/shared';
import { getDailyHealth } from '../repositories/dailyHealth.js';
import { badRequest, isoDate } from './validation.js';

const dailyHealthQuery = z.object({
  from: isoDate.default('1970-01-01'),
  to: isoDate.default('9999-12-31'),
  granularity: z.enum(['day', 'week', 'month', 'year']).default('day'),
});

export function registerDailyHealthRoutes(app: FastifyInstance, db: Database): void {
  app.get('/api/daily-health', async (request, reply): Promise<DailyHealthResponse> => {
    const parsed = dailyHealthQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const { from, to, granularity } = parsed.data;
    return {
      from,
      to,
      granularity,
      points: getDailyHealth(db, from, to, granularity),
    };
  });
}
