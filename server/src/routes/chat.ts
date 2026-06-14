import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runChat, type CompletionClient } from '../ai/chat.js';
import {
  addMessage,
  createConversation,
  deleteConversation,
  getConversation,
  getConversationDetail,
  listConversations,
  titleFrom,
} from '../repositories/chats.js';
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
  conversationId: z.number().int().positive().optional(),
  context: z.string().max(500).optional(),
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

  // Past conversations live in the writable events DB, independent of the AI key.
  app.get('/api/chat/conversations', async () => listConversations(opts.eventsDb));

  app.get('/api/chat/conversations/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const detail = getConversationDetail(opts.eventsDb, id);
    if (!detail) return reply.code(404).send({ error: 'not_found', message: `no conversation ${id}` });
    return detail;
  });

  app.delete('/api/chat/conversations/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deleteConversation(opts.eventsDb, id)) {
      return reply.code(404).send({ error: 'not_found', message: `no conversation ${id}` });
    }
    return { deleted: id };
  });

  app.post('/api/chat', async (request, reply) => {
    if (!opts.client) {
      return reply.code(503).send({
        error: 'ai_not_configured',
        message: 'Set OPENROUTER_API_KEY to enable the AI query layer.',
      });
    }
    const parsed = chatBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const { messages, conversationId, context } = parsed.data;

    try {
      const result = await runChat({
        client: opts.client,
        model: opts.model,
        ctx: { db: opts.db, eventsDb: opts.eventsDb },
        messages,
        context,
      });

      // Persist this turn: the new user message plus the assistant reply. A
      // missing/stale conversationId starts a fresh conversation.
      const lastUser = messages[messages.length - 1];
      const convId =
        conversationId && getConversation(opts.eventsDb, conversationId)
          ? conversationId
          : createConversation(opts.eventsDb, titleFrom(lastUser?.content ?? 'New chat')).id;
      if (lastUser?.role === 'user') {
        addMessage(opts.eventsDb, convId, 'user', lastUser.content, undefined, context);
      }
      addMessage(opts.eventsDb, convId, 'assistant', result.reply, result.toolCalls);

      return { ...result, conversationId: convId };
    } catch (e) {
      request.log.error(e);
      return reply.code(502).send({ error: 'ai_error', message: (e as Error).message });
    }
  });
}
