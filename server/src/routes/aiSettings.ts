import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getAiSettings, updateAiSettings } from '../repositories/aiSettings.js';
import { badRequest } from './validation.js';

const roleSettings = z
  .object({
    models: z.tuple([z.string().min(1).max(200), z.string().min(1).max(200), z.string().min(1).max(200)]),
    selected: z.string().min(1).max(200),
  })
  .refine((r) => r.models.includes(r.selected), { message: 'selected must be one of models', path: ['selected'] });

const aiSettingsBody = z.object({
  question: roleSettings,
  plan: roleSettings,
  analysis: roleSettings,
});

export function registerAiSettingsRoutes(app: FastifyInstance, eventsDb: Database): void {
  app.get('/api/ai-settings', async () => getAiSettings(eventsDb));

  app.put('/api/ai-settings', async (request, reply) => {
    const parsed = aiSettingsBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error);
    return updateAiSettings(eventsDb, parsed.data);
  });
}
