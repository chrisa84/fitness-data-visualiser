import { describe, expect, it } from 'vitest';
import { openEventsDb } from '../src/db.js';
import { listActivities } from '../src/repositories/activities.js';
import { openDb } from '../src/db.js';
import {
  DuplicateTagError,
  activityIdsWithAllTags,
  createTag,
  deleteTag,
  getActivityTagIds,
  listTags,
  setActivityTags,
  tagIdsForActivities,
  updateTag,
} from '../src/repositories/tags.js';
import { createTestDb } from './fixtures.js';

function db() {
  return openEventsDb(':memory:');
}

describe('tags repository', () => {
  it('creates, lists alphabetically, and counts usage', () => {
    const d = db();
    const stress = createTag(d, { name: 'stressful work', colour: '#e66a5f' });
    createTag(d, { name: 'antihistamine' });
    setActivityTags(d, 'a1', [stress.id]);
    setActivityTags(d, 'a2', [stress.id]);

    const tags = listTags(d);
    expect(tags.map((t) => t.name)).toEqual(['antihistamine', 'stressful work']);
    expect(tags.find((t) => t.name === 'stressful work')).toMatchObject({
      colour: '#e66a5f',
      activityCount: 2,
    });
    expect(tags.find((t) => t.name === 'antihistamine')!.activityCount).toBe(0);
  });

  it('rejects a duplicate name regardless of case', () => {
    const d = db();
    createTag(d, { name: 'New shoes' });
    expect(() => createTag(d, { name: 'new SHOES' })).toThrow(DuplicateTagError);
  });

  it('renames a tag but refuses to collide with another', () => {
    const d = db();
    const a = createTag(d, { name: 'easy' });
    createTag(d, { name: 'hard' });
    expect(updateTag(d, a.id, { name: 'recovery' })).toMatchObject({ name: 'recovery' });
    expect(() => updateTag(d, a.id, { name: 'hard' })).toThrow(DuplicateTagError);
    expect(updateTag(d, 999, { name: 'ghost' })).toBeNull();
  });

  it('replaces an activity tag set wholesale and ignores unknown ids', () => {
    const d = db();
    const a = createTag(d, { name: 'a' });
    const b = createTag(d, { name: 'b' });

    expect(setActivityTags(d, 'run1', [a.id, b.id])).toEqual([a.id, b.id]);
    // Assigning again replaces rather than appends, and a stale id is dropped
    // rather than failing the whole save.
    expect(setActivityTags(d, 'run1', [b.id, 4242])).toEqual([b.id]);
    expect(getActivityTagIds(d, 'run1')).toEqual([b.id]);
    expect(setActivityTags(d, 'run1', [])).toEqual([]);
  });

  it('deletes a tag and its assignments with it', () => {
    const d = db();
    const tag = createTag(d, { name: 'temporary' });
    setActivityTags(d, 'run1', [tag.id]);
    expect(deleteTag(d, tag.id)).toBe(true);
    expect(deleteTag(d, tag.id)).toBe(false);
    expect(getActivityTagIds(d, 'run1')).toEqual([]);
  });

  it('resolves activities carrying ALL requested tags, not any', () => {
    const d = db();
    const meds = createTag(d, { name: 'meds' });
    const stress = createTag(d, { name: 'stress' });
    setActivityTags(d, 'both', [meds.id, stress.id]);
    setActivityTags(d, 'medsOnly', [meds.id]);

    expect(activityIdsWithAllTags(d, [meds.id])!.sort()).toEqual(['both', 'medsOnly']);
    expect(activityIdsWithAllTags(d, [meds.id, stress.id])).toEqual(['both']);
    // No tags requested is "no filter"; a tag nobody uses is a real empty result.
    expect(activityIdsWithAllTags(d, [])).toBeUndefined();
    expect(activityIdsWithAllTags(d, [createTag(d, { name: 'unused' }).id])).toEqual([]);
  });

  it('builds a per-activity lookup without tripping over an empty page', () => {
    const d = db();
    const tag = createTag(d, { name: 'x' });
    setActivityTags(d, 'a1', [tag.id]);
    expect(tagIdsForActivities(d, ['a1', 'a2'])).toEqual({ a1: [tag.id] });
    expect(tagIdsForActivities(d, [])).toEqual({});
  });
});

describe('activity list filtering by id set', () => {
  const activities = [
    { activity_id: 'r1', type: 'running', start_time_local: '2025-01-01 08:00:00', distance_m: 5000 },
    { activity_id: 'r2', type: 'running', start_time_local: '2025-01-02 08:00:00', distance_m: 8000 },
  ];

  it('restricts to the given ids', () => {
    const garmin = openDb(createTestDb([], activities));
    const page = listActivities(garmin, {
      from: '2025-01-01',
      to: '2025-01-31',
      activityIds: ['r2'],
      sort: 'start_time',
      order: 'desc',
      limit: 50,
      offset: 0,
    });
    expect(page.total).toBe(1);
    expect(page.items.map((a) => a.activityId)).toEqual(['r2']);
  });

  it('treats an empty id set as "nothing matched", not "no filter"', () => {
    const garmin = openDb(createTestDb([], activities));
    const page = listActivities(garmin, {
      from: '2025-01-01',
      to: '2025-01-31',
      activityIds: [],
      sort: 'start_time',
      order: 'desc',
      limit: 50,
      offset: 0,
    });
    expect(page).toMatchObject({ total: 0, items: [] });
  });
});
