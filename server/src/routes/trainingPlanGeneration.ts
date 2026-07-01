import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import type { GeneratedTrainingPlan } from '@fitness/shared';
import { PlanGenerationError, buildPlanSummary, generatePlan } from '../ai/planGeneration.js';
import type { CompletionClient } from '../ai/chat.js';
import { getAiSettings } from '../repositories/aiSettings.js';
import { listEvents } from '../repositories/events.js';
import { getTrainingPlanAutofill } from '../repositories/trainingPlanAutofill.js';
import { generateTrainingPlanBody, reviseTrainingPlanBody } from '../schemas/trainingPlan.js';
import { badRequest } from './validation.js';

export interface TrainingPlanGenerationRouteOptions {
  client: CompletionClient | null;
  db: Database;
  eventsDb: Database;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The plan's end date is a hard fact computed here, never something the
 * model chooses: race day itself when racing, otherwise a span of exactly
 * `durationWeeks` weeks starting on `startDate` — `durationWeeks*7 - 1`
 * days later, since `startDate` itself is the first of those days (a
 * 1-week plan starting Monday ends the following Sunday, not the Monday
 * after).
 */
export function computeEndDate(input: { isRace: boolean; raceDate?: string; startDate: string; durationWeeks?: number }): string {
  if (input.isRace) return input.raceDate!;
  return addDays(input.startDate, input.durationWeeks! * 7 - 1);
}

/** AI-backed plan generation. The autofill endpoint is plain queries (no AI, no client needed). */
export function registerTrainingPlanGenerationRoutes(
  app: FastifyInstance,
  opts: TrainingPlanGenerationRouteOptions,
): void {
  app.get('/api/training-plans/autofill', async () => getTrainingPlanAutofill(opts.db));

  app.post('/api/training-plans/generate', async (request, reply) => {
    if (!opts.client) {
      return reply
        .code(503)
        .send({ error: 'ai_not_configured', message: 'Set OPENROUTER_API_KEY to enable plan generation.' });
    }
    const parsed = generateTrainingPlanBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error);

    const input = parsed.data;
    const endDate = computeEndDate(input);

    const events = listEvents(opts.eventsDb, input.startDate, endDate);
    const autofill = getTrainingPlanAutofill(opts.db);
    const summary = buildPlanSummary(input, endDate, autofill, events);
    const model = getAiSettings(opts.eventsDb).plan.selected;

    try {
      const ai = await generatePlan({
        client: opts.client,
        model,
        ctx: { db: opts.db, eventsDb: opts.eventsDb },
        summary,
        startDate: input.startDate,
        endDate,
        isRace: input.isRace,
      });
      const plan: GeneratedTrainingPlan = {
        goalDescription: input.goalDescription ?? '',
        isRace: input.isRace,
        goalRaceDistanceM: input.goalRaceDistanceM ?? null,
        goalTargetDurationS: input.goalTargetDurationS ?? null,
        startDate: input.startDate,
        endDate,
        daysPerWeek: input.daysPerWeek,
        rationale: ai.rationale,
        workouts: ai.workouts,
      };
      return plan;
    } catch (e) {
      request.log.error(e);
      if (e instanceof PlanGenerationError) {
        return reply.code(502).send({ error: 'plan_generation_failed', message: e.message });
      }
      // Anything else (network error, OpenRouter/provider-side failure, etc.) —
      // log it and return a clean JSON body instead of leaking Fastify's bare
      // default error response, matching chat.ts's equivalent catch-all.
      return reply.code(502).send({ error: 'ai_error', message: (e as Error).message });
    }
  });

  // Revise an unsaved draft — the model edits the existing workouts rather than designing
  // from scratch.
  app.post('/api/training-plans/revise', async (request, reply) => {
    if (!opts.client) {
      return reply
        .code(503)
        .send({ error: 'ai_not_configured', message: 'Set OPENROUTER_API_KEY to enable plan generation.' });
    }
    const parsed = reviseTrainingPlanBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error);

    const input = parsed.data;
    const events = listEvents(opts.eventsDb, input.startDate, input.endDate);
    const autofill = getTrainingPlanAutofill(opts.db);
    const summary = buildPlanSummary(input, input.endDate, autofill, events);
    const model = getAiSettings(opts.eventsDb).plan.selected;

    try {
      const ai = await generatePlan({
        client: opts.client,
        model,
        ctx: { db: opts.db, eventsDb: opts.eventsDb },
        summary,
        startDate: input.startDate,
        endDate: input.endDate,
        isRace: input.isRace,
        revision: {
          currentWorkouts: input.currentWorkouts,
          currentRationale: input.currentRationale,
          instructions: input.instructions,
        },
      });
      const plan: GeneratedTrainingPlan = {
        goalDescription: input.goalDescription ?? '',
        isRace: input.isRace,
        goalRaceDistanceM: input.goalRaceDistanceM ?? null,
        goalTargetDurationS: input.goalTargetDurationS ?? null,
        startDate: input.startDate,
        endDate: input.endDate,
        daysPerWeek: input.daysPerWeek,
        rationale: ai.rationale,
        workouts: ai.workouts,
      };
      return plan;
    } catch (e) {
      request.log.error(e);
      if (e instanceof PlanGenerationError) {
        return reply.code(502).send({ error: 'plan_generation_failed', message: e.message });
      }
      return reply.code(502).send({ error: 'ai_error', message: (e as Error).message });
    }
  });
}
