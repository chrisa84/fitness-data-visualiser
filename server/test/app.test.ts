import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createTestDb, createTrainingPlanAutofillDb } from './fixtures.js';

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

describe('GET/PUT /api/ai-settings', () => {
  it('returns seeded defaults', async () => {
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/ai-settings' });
    expect(res.statusCode).toBe(200);
    expect(res.json().question.selected).toBe('deepseek/deepseek-v4-flash');
  });

  it('rejects a selected value not in models', async () => {
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/ai-settings',
      payload: {
        question: { models: ['a', 'b', 'c'], selected: 'nope' },
        plan: { models: ['a', 'b', 'c'], selected: 'a' },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('persists a valid update', async () => {
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/ai-settings',
      payload: {
        question: { models: ['a', 'b', 'c'], selected: 'b' },
        plan: { models: ['x', 'y', 'z'], selected: 'z' },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().question.selected).toBe('b');
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

describe('training plans CRUD', () => {
  const planPayload = {
    goalDescription: 'half marathon in 1:50',
    startDate: '2026-01-01',
    endDate: '2026-03-01',
    daysPerWeek: 4,
  };

  it('creates, lists, ticks, deletes, and ends a plan', async () => {
    app = buildApp({ dbPath: createTestDb(seed), logger: false });

    const created = await app.inject({ method: 'POST', url: '/api/training-plans', payload: planPayload });
    expect(created.statusCode).toBe(201);
    const planId = created.json().plan.id;

    const list = await app.inject({ method: 'GET', url: '/api/training-plans' });
    expect(list.json()).toHaveLength(1);

    const workout = await app.inject({
      method: 'POST',
      url: `/api/training-plans/${planId}/workouts`,
      payload: { date: '2026-01-05', title: 'Easy 5k', workoutType: 'easy' },
    });
    expect(workout.statusCode).toBe(201);
    const workoutId = workout.json().id;

    const ticked = await app.inject({
      method: 'PATCH',
      url: `/api/training-plan-workouts/${workoutId}`,
      payload: { completedAt: '2026-01-05T08:00:00Z' },
    });
    expect(ticked.statusCode).toBe(200);
    expect(ticked.json().completedAt).toBe('2026-01-05T08:00:00Z');

    const deletedWorkout = await app.inject({
      method: 'DELETE',
      url: `/api/training-plan-workouts/${workoutId}`,
    });
    expect(deletedWorkout.statusCode).toBe(200);

    const ended = await app.inject({ method: 'POST', url: `/api/training-plans/${planId}/end` });
    expect(ended.statusCode).toBe(200);
    expect(ended.json().status).toBe('ended');
  });

  it('rejects creating a second active plan', async () => {
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const first = await app.inject({ method: 'POST', url: '/api/training-plans', payload: planPayload });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: 'POST', url: '/api/training-plans', payload: planPayload });
    expect(second.statusCode).toBe(409);
  });

  it('404s for unknown plan and workout ids', async () => {
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const getPlan = await app.inject({ method: 'GET', url: '/api/training-plans/999' });
    expect(getPlan.statusCode).toBe(404);
    const endPlan = await app.inject({ method: 'POST', url: '/api/training-plans/999/end' });
    expect(endPlan.statusCode).toBe(404);
    const patchWorkout = await app.inject({
      method: 'PATCH',
      url: '/api/training-plan-workouts/999',
      payload: { title: 'x' },
    });
    expect(patchWorkout.statusCode).toBe(404);
    const deleteWorkout = await app.inject({ method: 'DELETE', url: '/api/training-plan-workouts/999' });
    expect(deleteWorkout.statusCode).toBe(404);
  });

  it('rejects a bad workoutType and an over-horizon date range', async () => {
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const badType = await app.inject({
      method: 'POST',
      url: '/api/training-plans',
      payload: { ...planPayload, workouts: [{ date: '2026-01-05', title: 'x', workoutType: 'sprint' }] },
    });
    expect(badType.statusCode).toBe(400);

    const tooLong = await app.inject({
      method: 'POST',
      url: '/api/training-plans',
      payload: { ...planPayload, endDate: '2026-12-01' },
    });
    expect(tooLong.statusCode).toBe(400);
  });
});

describe('account allowlist gate', () => {
  const original = {
    ALLOWED_EMAIL: process.env.ALLOWED_EMAIL,
    ALLOWED_EMAILS: process.env.ALLOWED_EMAILS,
    REQUIRE_AUTH: process.env.REQUIRE_AUTH,
  };
  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('403s an api request whose proxy email does not match', async () => {
    process.env.ALLOWED_EMAILS = 'owner@example.com';
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-forwarded-email': 'stranger@example.com' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('403s a non-api request (the app shell) for a wrong account too', async () => {
    process.env.ALLOWED_EMAILS = 'owner@example.com';
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const res = await app.inject({
      method: 'GET',
      url: '/',
      headers: { 'x-forwarded-email': 'stranger@example.com' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('403s when no proxy email header is present', async () => {
    process.env.ALLOWED_EMAILS = 'owner@example.com';
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(403);
  });

  it('allows the matching account (case-insensitive)', async () => {
    process.env.ALLOWED_EMAILS = 'owner@example.com';
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-forwarded-email': 'Owner@Example.com' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('allows any account in a multi-email allowlist', async () => {
    process.env.ALLOWED_EMAILS = 'owner@example.com, partner@example.com';
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-forwarded-email': 'partner@example.com' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('still honours the legacy ALLOWED_EMAIL alias', async () => {
    delete process.env.ALLOWED_EMAILS;
    process.env.ALLOWED_EMAIL = 'owner@example.com';
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-forwarded-email': 'owner@example.com' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('fails closed: refuses to start when auth is required but unconfigured', () => {
    delete process.env.ALLOWED_EMAILS;
    delete process.env.ALLOWED_EMAIL;
    process.env.REQUIRE_AUTH = '1';
    expect(() => buildApp({ dbPath: createTestDb(seed), logger: false })).toThrow(/ALLOWED_EMAILS/);
  });

  it('stays open locally when auth is not required and no allowlist is set', async () => {
    delete process.env.ALLOWED_EMAILS;
    delete process.env.ALLOWED_EMAIL;
    delete process.env.REQUIRE_AUTH;
    app = buildApp({ dbPath: createTestDb(seed), logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
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

describe('training plan generation', () => {
  it('returns an autofill summary with no AI key required', async () => {
    app = buildApp({ dbPath: createTrainingPlanAutofillDb({}), logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/training-plans/autofill' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('weeklyVolumeTrend');
  });

  it('returns 503 from /api/training-plans/generate when not configured', async () => {
    app = buildApp({ dbPath: createTrainingPlanAutofillDb({}), logger: false });
    const res = await app.inject({
      method: 'POST',
      url: '/api/training-plans/generate',
      payload: { isRace: false, startDate: '2026-01-01', durationWeeks: 8, daysPerWeek: 4 },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('ai_not_configured');
  });

  it('rejects a generate request whose race date exceeds the 12-week horizon', async () => {
    // A dummy key so the request reaches validation instead of the 503 not-configured path.
    app = buildApp({
      dbPath: createTrainingPlanAutofillDb({}),
      logger: false,
      ai: { apiKey: 'test-key', baseUrl: 'http://localhost' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/training-plans/generate',
      payload: {
        isRace: true,
        startDate: '2026-01-01',
        raceDate: '2026-12-01',
        goalRaceDistanceM: 21097,
        daysPerWeek: 4,
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
