import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createTestDb } from './fixtures.js';

const daily = [{ date: '2025-01-01', resting_hr: 50 }];
const activities = [
  { activity_id: 'r1', name: 'Morning run', type: 'running', start_time_local: '2025-01-01 08:00:00', distance_m: 5000 },
  { activity_id: 'r2', name: 'Evening run', type: 'running', start_time_local: '2025-01-02 18:00:00', distance_m: 8000 },
];

let app: ReturnType<typeof buildApp> | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function start() {
  app = buildApp({ dbPath: createTestDb(daily, activities), logger: false });
  return app;
}

async function createTag(name: string, colour?: string) {
  const res = await app!.inject({ method: 'POST', url: '/api/tags', payload: { name, colour } });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: number; name: string };
}

describe('tag routes', () => {
  it('creates, lists, renames and deletes a tag', async () => {
    start();
    const tag = await createTag('stressful work', '#e66a5f');
    expect(tag).toMatchObject({ name: 'stressful work', activityCount: 0 });

    const list = await app!.inject({ method: 'GET', url: '/api/tags' });
    expect(list.json()).toHaveLength(1);

    const renamed = await app!.inject({
      method: 'PATCH',
      url: `/api/tags/${tag.id}`,
      payload: { name: 'busy week' },
    });
    expect(renamed.json()).toMatchObject({ name: 'busy week', colour: null });

    const deleted = await app!.inject({ method: 'DELETE', url: `/api/tags/${tag.id}` });
    expect(deleted.statusCode).toBe(200);
    expect((await app!.inject({ method: 'GET', url: '/api/tags' })).json()).toEqual([]);
  });

  it('409s a duplicate name and 404s an unknown id', async () => {
    start();
    await createTag('meds');
    const dupe = await app!.inject({ method: 'POST', url: '/api/tags', payload: { name: 'MEDS' } });
    expect(dupe.statusCode).toBe(409);
    expect(dupe.json().error).toBe('duplicate_tag');

    expect((await app!.inject({ method: 'DELETE', url: '/api/tags/999' })).statusCode).toBe(404);
    expect(
      (await app!.inject({ method: 'PATCH', url: '/api/tags/999', payload: { name: 'x' } })).statusCode,
    ).toBe(404);
  });

  it('rejects a blank name and a malformed colour', async () => {
    start();
    expect((await app!.inject({ method: 'POST', url: '/api/tags', payload: { name: '  ' } })).statusCode).toBe(400);
    expect(
      (await app!.inject({ method: 'POST', url: '/api/tags', payload: { name: 'x', colour: 'red' } })).statusCode,
    ).toBe(400);
  });

  it('assigns tags to an activity and reads them back', async () => {
    start();
    const a = await createTag('a');
    const b = await createTag('b');

    const put = await app!.inject({
      method: 'PUT',
      url: '/api/activities/r1/tags',
      payload: { tagIds: [a.id, b.id] },
    });
    expect(put.json()).toEqual({ activityId: 'r1', tagIds: [a.id, b.id] });

    const get = await app!.inject({ method: 'GET', url: '/api/activities/r1/tags' });
    expect(get.json()).toEqual({ activityId: 'r1', tagIds: [a.id, b.id] });
  });

  it('filters the activity list by tag and decorates rows with their tags', async () => {
    start();
    const meds = await createTag('meds');
    const stress = await createTag('stress');
    await app!.inject({ method: 'PUT', url: '/api/activities/r1/tags', payload: { tagIds: [meds.id] } });
    await app!.inject({
      method: 'PUT',
      url: '/api/activities/r2/tags',
      payload: { tagIds: [meds.id, stress.id] },
    });

    const all = await app!.inject({ method: 'GET', url: '/api/activities' });
    expect(all.json().items.find((a: { activityId: string }) => a.activityId === 'r1').tagIds).toEqual([meds.id]);

    const oneTag = await app!.inject({ method: 'GET', url: `/api/activities?tags=${meds.id}` });
    expect(oneTag.json().total).toBe(2);

    // Multiple tags narrow (AND), so only the doubly-tagged activity survives.
    const bothTags = await app!.inject({
      method: 'GET',
      url: `/api/activities?tags=${meds.id},${stress.id}`,
    });
    expect(bothTags.json().total).toBe(1);
    expect(bothTags.json().items[0].activityId).toBe('r2');
  });

  it('returns an empty page for a tag nobody uses', async () => {
    start();
    const unused = await createTag('unused');
    const res = await app!.inject({ method: 'GET', url: `/api/activities?tags=${unused.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 0, items: [] });
  });
});

describe('experimental routes', () => {
  it('serves sleep timing with its regularity window', async () => {
    app = buildApp({
      dbPath: createTestDb([
        {
          date: '2025-01-06',
          sleep_start: '2025-01-05T23:00:00+00:00',
          sleep_end: '2025-01-06T07:00:00+00:00',
        },
      ]),
      logger: false,
    });
    const res = await app.inject({ method: 'GET', url: '/api/experimental/sleep-timing' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ regularityWindowNights: 14 });
    expect(res.json().nights).toHaveLength(1);
  });

  it('validates cohort metric keys and operators', async () => {
    start();
    const ok = await app!.inject({
      method: 'GET',
      url: '/api/experimental/cohort?splitKey=sleep_hours&splitValue=6&outcomeKey=resting_hr',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ splitOp: 'lt', lagDays: 1 });

    const badKey = await app!.inject({
      method: 'GET',
      url: '/api/experimental/cohort?splitKey=not_a_metric&splitValue=6&outcomeKey=resting_hr',
    });
    expect(badKey.statusCode).toBe(400);

    const badLag = await app!.inject({
      method: 'GET',
      url: '/api/experimental/cohort?splitKey=sleep_hours&splitValue=6&outcomeKey=resting_hr&lagDays=99',
    });
    expect(badLag.statusCode).toBe(400);
  });
});
