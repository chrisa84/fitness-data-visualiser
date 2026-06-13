import type { FastifyReply } from 'fastify';
import { z } from 'zod';

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export function badRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: 'bad_request',
    message: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
  });
}
