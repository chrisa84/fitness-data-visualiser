import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { COHORT_OPS, METRIC_KEYS, resolveActivityTypeFilter } from '@fitness/shared';
import { getFitnessTrend } from '../repositories/experimental.js';
import { getCohortComparison } from '../repositories/experimentalCohort.js';
import { REGULARITY_WINDOW_NIGHTS, getSleepTiming } from '../repositories/experimentalSleep.js';
import { badRequest, isoDate } from './validation.js';

// EXPERIMENTAL (Phase 20, extended Phase 21) — everything under
// /api/experimental backs the Experimental section of the nav and may be
// removed wholesale. See EXPERIMENTS.md for the per-feature removal map.

const fitnessTrendQuery = z.object({
  from: isoDate.default('1970-01-01'),
  to: isoDate.default('9999-12-31'),
  granularity: z.enum(['day', 'week', 'month', 'year']).default('week'),
  type: z.string().min(1).default('group:running'),
});

const sleepTimingQuery = z.object({
  from: isoDate.default('1970-01-01'),
  to: isoDate.default('9999-12-31'),
});

const metricKey = z.enum(METRIC_KEYS as [string, ...string[]]);

const cohortQuery = z.object({
  splitKey: metricKey,
  splitOp: z.enum(COHORT_OPS).default('lt'),
  splitValue: z.coerce.number(),
  outcomeKey: metricKey,
  // A lag of a day or two is the useful range ("the morning after"); anything
  // longer is a different question and mostly noise.
  lagDays: z.coerce.number().int().min(0).max(7).default(1),
  from: isoDate.default('1970-01-01'),
  to: isoDate.default('9999-12-31'),
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

  app.get('/api/experimental/sleep-timing', async (request, reply) => {
    const parsed = sleepTimingQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const { from, to } = parsed.data;
    return {
      from,
      to,
      regularityWindowNights: REGULARITY_WINDOW_NIGHTS,
      ...getSleepTiming(db, { from, to }),
    };
  });

  app.get('/api/experimental/cohort', async (request, reply) => {
    const parsed = cohortQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error);
    return getCohortComparison(db, parsed.data);
  });
}
