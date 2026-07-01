import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { PlanGenerationError, buildPlanSummary, generatePlan } from '../ai/planGeneration.js';
import type { CompletionClient } from '../ai/chat.js';
import { getAiSettings } from '../repositories/aiSettings.js';
import { listEvents } from '../repositories/events.js';
import { getTrainingPlanAutofill } from '../repositories/trainingPlanAutofill.js';
import { generateTrainingPlanBody } from '../schemas/trainingPlan.js';
import { badRequest } from './validation.js';

export interface TrainingPlanGenerationRouteOptions {
  client: CompletionClient | null;
  db: Database;
  eventsDb: Database;
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

    const { startDate, endDate } = parsed.data;
    const events = listEvents(opts.eventsDb, startDate, endDate);
    const summary = buildPlanSummary(parsed.data, events);
    const model = getAiSettings(opts.eventsDb).plan.selected;

    try {
      const plan = await generatePlan({
        client: opts.client,
        model,
        ctx: { db: opts.db, eventsDb: opts.eventsDb },
        summary,
      });
      return plan;
    } catch (e) {
      if (e instanceof PlanGenerationError) {
        request.log.error(e);
        return reply.code(502).send({ error: 'plan_generation_failed', message: e.message });
      }
      throw e;
    }
  });
}
