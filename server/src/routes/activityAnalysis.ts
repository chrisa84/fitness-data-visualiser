import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { analyzeActivity, buildActivitySummary } from '../ai/activityAnalysis.js';
import type { CompletionClient } from '../ai/chat.js';
import { getAiSettings } from '../repositories/aiSettings.js';
import { getActivity, getActivitySamples } from '../repositories/activities.js';
import { badRequest } from './validation.js';

const analyzeBody = z.object({
  question: z.string().max(2000).optional(),
  model: z.string().min(1).max(200).optional(),
});

export interface ActivityAnalysisRouteOptions {
  client: CompletionClient | null;
  db: Database;
  eventsDb: Database;
}

export function registerActivityAnalysisRoutes(
  app: FastifyInstance,
  opts: ActivityAnalysisRouteOptions,
): void {
  app.post('/api/activities/:id/analyze', async (request, reply) => {
    if (!opts.client) {
      return reply.code(503).send({
        error: 'ai_not_configured',
        message: 'Set OPENROUTER_API_KEY to enable the AI query layer.',
      });
    }
    const parsed = analyzeBody.safeParse(request.body ?? {});
    if (!parsed.success) return badRequest(reply, parsed.error);

    const id = (request.params as { id: string }).id;
    const activity = getActivity(opts.db, id);
    if (!activity) return reply.code(404).send({ error: 'not_found', message: `no activity ${id}` });

    const settings = getAiSettings(opts.eventsDb).analysis;
    // A model override must be one of the configured candidates, not free text.
    const model =
      parsed.data.model && settings.models.includes(parsed.data.model)
        ? parsed.data.model
        : settings.selected;

    try {
      const summary = buildActivitySummary(activity, getActivitySamples(opts.db, id));
      const analysis = await analyzeActivity({
        client: opts.client,
        model,
        summary,
        question: parsed.data.question,
      });
      return { analysis, model };
    } catch (e) {
      request.log.error(e);
      return reply.code(502).send({ error: 'ai_error', message: (e as Error).message });
    }
  });
}
