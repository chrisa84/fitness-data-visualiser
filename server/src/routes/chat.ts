import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runChat, type CompletionClient } from '../ai/chat.js';
import { badRequest } from './validation.js';

const chatBody = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(40),
});

export interface ChatRouteOptions {
  client: CompletionClient | null;
  model: string;
  db: Database;
  eventsDb: Database;
}

export function registerChatRoutes(app: FastifyInstance, opts: ChatRouteOptions): void {
  app.get('/api/chat/status', async () => ({
    enabled: opts.client !== null,
    model: opts.model,
  }));

  app.post('/api/chat', async (request, reply) => {
    if (!opts.client) {
      return reply.code(503).send({
        error: 'ai_not_configured',
        message: 'Set OPENROUTER_API_KEY to enable the AI query layer.',
      });
    }
    const parsed = chatBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error);

    try {
      const result = await runChat({
        client: opts.client,
        model: opts.model,
        ctx: { db: opts.db, eventsDb: opts.eventsDb },
        messages: parsed.data.messages,
      });
      return result;
    } catch (e) {
      request.log.error(e);
      return reply.code(502).send({ error: 'ai_error', message: (e as Error).message });
    }
  });
}
