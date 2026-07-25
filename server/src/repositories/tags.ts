import type { Database } from 'better-sqlite3';
import type { Tag, TagInput } from '@fitness/shared';

/**
 * User-defined activity tags, in the writable events DB. The Garmin mirror is
 * never touched here: `activity_tag.activity_id` is just a Garmin id stored on
 * this side, so tags survive independently of what the mirror currently holds.
 *
 * Cross-database filtering is deliberately a two-step (resolve ids here, then
 * `activity_id IN (...)` against the Garmin DB) rather than an ATTACH — it
 * keeps the read-only boundary a hard one instead of a convention.
 */

/** Thrown when a tag name collides with an existing one (unique, case-insensitive). */
export class DuplicateTagError extends Error {
  constructor(name: string) {
    super(`a tag named "${name}" already exists`);
    this.name = 'DuplicateTagError';
  }
}

function mapTag(r: Record<string, unknown>): Tag {
  return {
    id: r.id as number,
    name: r.name as string,
    colour: (r.colour as string | null) ?? null,
    activityCount: (r.activity_count as number | undefined) ?? 0,
    createdAt: r.created_at as string,
  };
}

const SELECT_WITH_COUNT = `
  SELECT tag.id, tag.name, tag.colour, tag.created_at,
         COUNT(activity_tag.activity_id) AS activity_count
  FROM tag
  LEFT JOIN activity_tag ON activity_tag.tag_id = tag.id
`;

export function listTags(db: Database): Tag[] {
  const rows = db
    .prepare(`${SELECT_WITH_COUNT} GROUP BY tag.id ORDER BY tag.name COLLATE NOCASE`)
    .all() as Record<string, unknown>[];
  return rows.map(mapTag);
}

export function getTag(db: Database, id: number): Tag | null {
  const row = db
    .prepare(`${SELECT_WITH_COUNT} WHERE tag.id = ? GROUP BY tag.id`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapTag(row) : null;
}

/** Maps a SQLite unique-constraint violation onto a typed error the route can 409. */
function rethrowDuplicate(error: unknown, name: string): never {
  if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
    throw new DuplicateTagError(name);
  }
  throw error;
}

export function createTag(db: Database, input: TagInput): Tag {
  let id: number;
  try {
    const info = db
      .prepare('INSERT INTO tag (name, colour, created_at) VALUES (@name, @colour, @createdAt)')
      .run({
        name: input.name.trim(),
        colour: input.colour ?? null,
        createdAt: new Date().toISOString(),
      });
    id = Number(info.lastInsertRowid);
  } catch (error) {
    rethrowDuplicate(error, input.name);
  }
  return getTag(db, id)!;
}

export function updateTag(db: Database, id: number, input: TagInput): Tag | null {
  if (!getTag(db, id)) return null;
  try {
    db.prepare('UPDATE tag SET name = @name, colour = @colour WHERE id = @id').run({
      id,
      name: input.name.trim(),
      colour: input.colour ?? null,
    });
  } catch (error) {
    rethrowDuplicate(error, input.name);
  }
  return getTag(db, id);
}

/** Deletes a tag; its `activity_tag` rows go with it (ON DELETE CASCADE). */
export function deleteTag(db: Database, id: number): boolean {
  return db.prepare('DELETE FROM tag WHERE id = ?').run(id).changes > 0;
}

export function getActivityTagIds(db: Database, activityId: string): number[] {
  const rows = db
    .prepare('SELECT tag_id FROM activity_tag WHERE activity_id = ? ORDER BY tag_id')
    .all(activityId) as { tag_id: number }[];
  return rows.map((r) => r.tag_id);
}

/**
 * Replaces an activity's whole tag set, transactionally. Unknown tag ids are
 * dropped rather than erroring — a stale browser tab holding a since-deleted
 * tag should not fail the whole save.
 */
export function setActivityTags(db: Database, activityId: string, tagIds: number[]): number[] {
  const apply = db.transaction((ids: number[]) => {
    db.prepare('DELETE FROM activity_tag WHERE activity_id = ?').run(activityId);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO activity_tag (activity_id, tag_id, created_at)
       SELECT @activityId, @tagId, @createdAt WHERE EXISTS (SELECT 1 FROM tag WHERE id = @tagId)`,
    );
    const createdAt = new Date().toISOString();
    for (const tagId of new Set(ids)) insert.run({ activityId, tagId, createdAt });
  });
  apply(tagIds);
  return getActivityTagIds(db, activityId);
}

/**
 * Tag ids per activity for a page of activities, as a lookup the list route
 * overlays onto its rows. Returns `{}` for an empty input rather than building
 * an `IN ()`, which is not valid SQL.
 */
export function tagIdsForActivities(
  db: Database,
  activityIds: string[],
): Record<string, number[]> {
  if (activityIds.length === 0) return {};
  const placeholders = activityIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT activity_id, tag_id FROM activity_tag
       WHERE activity_id IN (${placeholders}) ORDER BY tag_id`,
    )
    .all(...activityIds) as { activity_id: string; tag_id: number }[];

  const out: Record<string, number[]> = {};
  for (const row of rows) (out[row.activity_id] ??= []).push(row.tag_id);
  return out;
}

/**
 * Activity ids carrying **all** of the given tags (AND, not OR) — asking for
 * "medicated" plus "stressful work" should narrow, not widen. An empty tag list
 * means "no tag filter" and returns undefined so callers can skip the clause;
 * a tag with no activities correctly returns an empty array, which the caller
 * must treat as "no results" rather than "no filter".
 */
export function activityIdsWithAllTags(db: Database, tagIds: number[]): string[] | undefined {
  if (tagIds.length === 0) return undefined;
  const unique = [...new Set(tagIds)];
  const placeholders = unique.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT activity_id FROM activity_tag
       WHERE tag_id IN (${placeholders})
       GROUP BY activity_id
       HAVING COUNT(DISTINCT tag_id) = ?`,
    )
    .all(...unique, unique.length) as { activity_id: string }[];
  return rows.map((r) => r.activity_id);
}
