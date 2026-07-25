import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  DuplicateTagError,
  createTag,
  deleteTag,
  getActivityTagIds,
  listTags,
  setActivityTags,
  updateTag,
} from '../repositories/tags.js';
import { badRequest } from './validation.js';

const tagBody = z.object({
  name: z.string().trim().min(1).max(60),
  colour: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'colour must be a #rrggbb hex value')
    .nullish(),
});

const activityTagsBody = z.object({
  tagIds: z.array(z.number().int().positive()).max(50),
});

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** CRUD for user-defined activity tags, backed by the writable database. */
export function registerTagRoutes(app: FastifyInstance, eventsDb: Database): void {
  app.get('/api/tags', async () => listTags(eventsDb));

  app.post('/api/tags', async (request, reply) => {
    const parsed = tagBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error);
    try {
      return reply.code(201).send(createTag(eventsDb, parsed.data));
    } catch (error) {
      if (error instanceof DuplicateTagError) {
        return reply.code(409).send({ error: 'duplicate_tag', message: error.message });
      }
      throw error;
    }
  });

  app.patch('/api/tags/:id', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (id == null) return reply.code(400).send({ error: 'bad_request', message: 'invalid tag id' });
    const parsed = tagBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error);
    try {
      const updated = updateTag(eventsDb, id, parsed.data);
      if (!updated) return reply.code(404).send({ error: 'not_found', message: `no tag ${id}` });
      return updated;
    } catch (error) {
      if (error instanceof DuplicateTagError) {
        return reply.code(409).send({ error: 'duplicate_tag', message: error.message });
      }
      throw error;
    }
  });

  app.delete('/api/tags/:id', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (id == null || !deleteTag(eventsDb, id)) {
      return reply.code(404).send({ error: 'not_found', message: `no tag ${id}` });
    }
    return { deleted: id };
  });

  // Per-activity assignment. The activity id is not validated against the
  // Garmin mirror — these routes only touch the writable DB, and a tag on an
  // id the mirror has not synced yet is harmless (it simply shows up later).
  app.get('/api/activities/:id/tags', async (request) => {
    const { id } = request.params as { id: string };
    return { activityId: id, tagIds: getActivityTagIds(eventsDb, id) };
  });

  app.put('/api/activities/:id/tags', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = activityTagsBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error);
    return { activityId: id, tagIds: setActivityTags(eventsDb, id, parsed.data.tagIds) };
  });
}
