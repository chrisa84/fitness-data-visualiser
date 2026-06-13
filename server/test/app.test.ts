import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createTestDb } from './fixtures.js';

const seed = [{ date: '2025-01-01', resting_hr: 50, total_steps: 10000, avg_stress_level: 20 }];

let app: ReturnType<typeof buildApp> | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /api/health', () => {
  it('reports row count', async () => {
    app = buildApp({ dbPath: createTestDb(seed) });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', dailySummaryRows: 1 });
  });
});

describe('GET /api/activities', () => {
  it('rejects bad limit', async () => {
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/activities?limit=9999' });
    expect(res.statusCode).toBe(400);
  });

  it('returns empty list when no activities', async () => {
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/activities' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 0, items: [] });
  });

  it('404s on unknown activity id', async () => {
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/activities/12345' });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/daily-health', () => {
  it('returns the full series with defaults', async () => {
    app = buildApp({ dbPath: createTestDb(seed) });
    const res = await app.inject({ method: 'GET', url: '/api/daily-health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.granularity).toBe('day');
    expect(body.points).toHaveLength(1);
  });

  it('rejects malformed dates', async () => {
    app = buildApp({ dbPath: createTestDb(seed) });
    const res = await app.inject({ method: 'GET', url: '/api/daily-health?from=01-01-2025' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('bad_request');
  });

  it('rejects unknown granularity', async () => {
    app = buildApp({ dbPath: createTestDb(seed) });
    const res = await app.inject({ method: 'GET', url: '/api/daily-health?granularity=fortnight' });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/metrics', () => {
  it('returns aligned values for known keys', async () => {
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/metrics?keys=resting_hr' });
    expect(res.statusCode).toBe(200);
    expect(res.json().points[0]).toEqual({ date: '2025-01-01', values: { resting_hr: 50 } });
  });

  it('rejects unknown metric keys', async () => {
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/metrics?keys=bogus' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an empty keys list', async () => {
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/metrics' });
    expect(res.statusCode).toBe(400);
  });
});

describe('events CRUD', () => {
  it('creates, lists, and deletes an event', async () => {
    app = buildApp({ dbPath: createTestDb(seed), logger: false });

    const created = await app.inject({
      method: 'POST',
      url: '/api/events',
      payload: { date: '2025-05-01', type: 'race', label: 'Marathon' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const list = await app.inject({ method: 'GET', url: '/api/events' });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0]).toMatchObject({ label: 'Marathon', type: 'race' });

    const del = await app.inject({ method: 'DELETE', url: `/api/events/${id}` });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/api/events' });
    expect(after.json()).toEqual([]);
  });

  it('rejects an invalid event type', async () => {
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      payload: { date: '2025-05-01', type: 'wedding', label: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a range whose end is before its start', async () => {
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      payload: { date: '2025-12-08', endDate: '2025-06-13', type: 'life', label: 'reversed' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('404s when deleting a missing event', async () => {
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const res = await app.inject({ method: 'DELETE', url: '/api/events/999' });
    expect(res.statusCode).toBe(404);
  });
});

describe('AI chat', () => {
  it('reports disabled status when no API key is configured', async () => {
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/chat/status' });
    expect(res.json()).toMatchObject({ enabled: false });
  });

  it('returns 503 from /api/chat when not configured', async () => {
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('ai_not_configured');
  });
});
