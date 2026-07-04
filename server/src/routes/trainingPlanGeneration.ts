import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import type { GeneratedTrainingPlan } from '@fitness/shared';
import { PlanGenerationError, buildPlanSummary, generatePlan } from '../ai/planGeneration.js';
import { PlanReviewError, buildReviewSummary, reviewPlan, validateProposedAdjustment } from '../ai/planReview.js';
import type { CompletionClient } from '../ai/chat.js';
import { getAiSettings } from '../repositories/aiSettings.js';
import { listEvents } from '../repositories/events.js';
import { getTrainingPlan, listWorkouts } from '../repositories/trainingPlans.js';
import { getTrainingPlanAutofill } from '../repositories/trainingPlanAutofill.js';
import { applyPlanReview } from '../repositories/trainingPlanReview.js';
import { applyPlanReviewBody, generateTrainingPlanBody, reviewPlanBody, reviseTrainingPlanBody } from '../schemas/trainingPlan.js';
import { badRequest } from './validation.js';
import { localToday } from '../dates.js';

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

/**
 * The window of the plan a review may touch: `next-week` is capped at 6 days
 * out (never past the plan's own end date), `remaining` runs to the plan's
 * end date. `scopeStart` is always today — nothing before it is offered to
 * the model as modifiable in the first place.
 */
function computeReviewScope(scope: 'next-week' | 'remaining', today: string, planEndDate: string): { scopeStart: string; scopeEnd: string } {
  const scopeEnd = scope === 'next-week' ? addDays(today, 6) : planEndDate;
  return { scopeStart: today, scopeEnd: scopeEnd < planEndDate ? scopeEnd : planEndDate };
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

  // Review an active, already-saved plan — proposes patches against existing workout IDs.
  // Nothing is persisted here; the client previews the diff and calls .../review/apply.
  app.post('/api/training-plans/:id/review', async (request, reply) => {
    if (!opts.client) {
      return reply
        .code(503)
        .send({ error: 'ai_not_configured', message: 'Set OPENROUTER_API_KEY to enable plan review.' });
    }
    const id = Number((request.params as { id: string }).id);
    const plan = getTrainingPlan(opts.eventsDb, id);
    if (!plan) return reply.code(404).send({ error: 'not_found', message: `no training plan ${id}` });

    const parsed = reviewPlanBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const input = parsed.data;

    const today = localToday();
    const { scopeStart, scopeEnd } = computeReviewScope(input.scope, today, plan.endDate);
    const workouts = listWorkouts(opts.eventsDb, id);
    const inScopeWorkouts = workouts.filter((w) => w.completedAt == null && w.date >= scopeStart && w.date <= scopeEnd);

    const events = listEvents(opts.eventsDb, addDays(today, -28), scopeEnd);
    const autofill = getTrainingPlanAutofill(opts.db, today);
    const summary = buildReviewSummary({ plan, workouts, inScopeWorkouts, scope: input.scope, scopeStart, scopeEnd, feeling: input.feeling, autofill, events, today });
    const model = getAiSettings(opts.eventsDb).plan.selected;

    try {
      const adjustment = await reviewPlan({
        client: opts.client,
        model,
        ctx: { db: opts.db, eventsDb: opts.eventsDb },
        today,
        summary,
        isRace: plan.isRace,
        notes: input.notes,
      });
      validateProposedAdjustment({ plan, workouts, scopeStart, scopeEnd, adjustment });
      return adjustment;
    } catch (e) {
      request.log.error(e);
      if (e instanceof PlanReviewError) {
        return reply.code(502).send({ error: 'plan_review_failed', message: e.message });
      }
      return reply.code(502).send({ error: 'ai_error', message: (e as Error).message });
    }
  });

  // Apply exactly the user-accepted subset of a previous /review response. Re-validates
  // against fresh plan state (time may have passed since the preview was shown) rather
  // than trusting the client-echoed payload, then applies transactionally.
  app.post('/api/training-plans/:id/review/apply', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const plan = getTrainingPlan(opts.eventsDb, id);
    if (!plan) return reply.code(404).send({ error: 'not_found', message: `no training plan ${id}` });

    const parsed = applyPlanReviewBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const input = parsed.data;
    if (input.modify.length === 0 && input.remove.length === 0 && input.add.length === 0) {
      return reply.code(400).send({ error: 'nothing_to_apply', message: 'no changes were selected' });
    }

    const today = localToday();
    // A prior review scoped the proposal, but by apply time we don't know which scope
    // was used — re-derive the widest possible bound (remaining plan) so a still-valid
    // change from a since-widened plan isn't rejected on a stale narrower window.
    const { scopeStart, scopeEnd } = computeReviewScope('remaining', today, plan.endDate);
    const workouts = listWorkouts(opts.eventsDb, id);

    try {
      validateProposedAdjustment({
        plan,
        workouts,
        scopeStart,
        scopeEnd,
        adjustment: { overallAssessment: '', adjustmentReason: input.rationale, modify: input.modify, remove: input.remove, add: input.add },
      });
    } catch (e) {
      if (e instanceof PlanReviewError) {
        return reply.code(409).send({ error: 'plan_review_stale', message: e.message });
      }
      throw e;
    }

    const revision = applyPlanReview(opts.eventsDb, id, input);
    return reply.code(201).send(revision);
  });
}
