import { describe, expect, it, vi } from 'vitest';
import { openDb, openEventsDb } from '../src/db.js';
import { PlanGenerationError, generatePlan } from '../src/ai/planGeneration.js';
import type { CompletionClient } from '../src/ai/chat.js';
import { getTrainingPlanAutofill } from '../src/repositories/trainingPlanAutofill.js';
import { createTestDb, createTrainingPlanAutofillDb } from './fixtures.js';

function ctx() {
  return { db: openDb(createTestDb([])), eventsDb: openEventsDb(':memory:') };
}

const validArgs = {
  goalDescription: 'half marathon in 1:50',
  isRace: true,
  goalRaceDistanceM: 21097,
  goalTargetDurationS: 6600,
  startDate: '2026-01-01',
  endDate: '2026-02-26',
  daysPerWeek: 4,
  rationale: 'feasible given current base',
  workouts: [
    { date: '2026-01-05', title: 'Easy 5k', workoutType: 'easy' },
    { date: '2026-01-07', title: 'Long run 10k', workoutType: 'long' },
  ],
};

function proposeCallResponse(args: unknown) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'p1', type: 'function', function: { name: 'propose_plan', arguments: JSON.stringify(args) } }],
        },
      },
    ],
  };
}

const freeTextResponse = { choices: [{ message: { role: 'assistant', content: 'thinking…' } }] };

describe('generatePlan', () => {
  it('instructs the model to taper races, cap hard sessions, and ground rationale in real numbers', async () => {
    const create = vi.fn().mockResolvedValueOnce(proposeCallResponse(validArgs));
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    await generatePlan({ client, model: 'test', ctx: ctx(), summary: 'goal summary' });

    const systemMessage = create.mock.calls[0]![0].messages[0].content as string;
    expect(systemMessage).toMatch(/taper/i);
    expect(systemMessage).toMatch(/at most one tempo and one interval/i);
    expect(systemMessage).toMatch(/name the specific figures/i);
    expect(systemMessage).toContain('goal summary');
  });

  it('accepts an early propose_plan call before the forced step', async () => {
    const create = vi.fn().mockResolvedValueOnce(proposeCallResponse(validArgs));
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    const plan = await generatePlan({ client, model: 'test', ctx: ctx(), summary: 'goal summary' });

    expect(plan.goalDescription).toBe(validArgs.goalDescription);
    expect(plan.workouts).toHaveLength(2);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].tool_choice).toBe('auto');
  });

  it('forces tool_choice to propose_plan on the final allowed step', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(freeTextResponse)
      .mockResolvedValueOnce(freeTextResponse)
      .mockResolvedValueOnce(freeTextResponse)
      .mockResolvedValueOnce(freeTextResponse)
      .mockResolvedValueOnce(freeTextResponse)
      .mockResolvedValueOnce(freeTextResponse)
      .mockResolvedValueOnce(freeTextResponse)
      .mockResolvedValueOnce(proposeCallResponse(validArgs));
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    const plan = await generatePlan({ client, model: 'test', ctx: ctx(), summary: 'goal summary' });

    expect(plan.goalDescription).toBe(validArgs.goalDescription);
    expect(create).toHaveBeenCalledTimes(8);
    for (let i = 0; i < 7; i += 1) {
      expect(create.mock.calls[i]![0].tool_choice).toBe('auto');
    }
    expect(create.mock.calls[7]![0].tool_choice).toEqual({
      type: 'function',
      function: { name: 'propose_plan' },
    });
  });

  it('continues the loop (with a nudge) instead of accepting free text as an answer', async () => {
    const create = vi.fn().mockResolvedValueOnce(freeTextResponse).mockResolvedValueOnce(proposeCallResponse(validArgs));
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    const plan = await generatePlan({ client, model: 'test', ctx: ctx(), summary: 'goal summary' });

    expect(plan.goalDescription).toBe(validArgs.goalDescription);
    expect(create).toHaveBeenCalledTimes(2);
    const secondCallMessages = create.mock.calls[1]![0].messages as { role: string; content: string }[];
    expect(secondCallMessages.some((m) => m.role === 'user' && m.content.includes('propose_plan'))).toBe(true);
  });

  it('rejects invalid propose_plan arguments', async () => {
    const create = vi.fn().mockResolvedValueOnce(proposeCallResponse({ ...validArgs, workouts: [{ date: '2026-01-05', title: 'x', workoutType: 'sprint' }] }));
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    await expect(generatePlan({ client, model: 'test', ctx: ctx(), summary: 'goal summary' })).rejects.toThrow(
      PlanGenerationError,
    );
  });

  it('throws when the model never produces a valid propose_plan call', async () => {
    const create = vi.fn().mockResolvedValue(freeTextResponse);
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    await expect(generatePlan({ client, model: 'test', ctx: ctx(), summary: 'goal summary' })).rejects.toThrow(
      PlanGenerationError,
    );
    expect(create).toHaveBeenCalledTimes(8);
  });

  it('throws a clean PlanGenerationError rather than crashing on a malformed provider response', async () => {
    const create = vi.fn().mockResolvedValueOnce({}); // no `choices` at all
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    await expect(generatePlan({ client, model: 'test', ctx: ctx(), summary: 'goal summary' })).rejects.toThrow(
      PlanGenerationError,
    );
  });

  it('only offers a small, plan-relevant subset of tools, not the full chat toolset', async () => {
    const create = vi.fn().mockResolvedValueOnce(proposeCallResponse(validArgs));
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    await generatePlan({ client, model: 'test', ctx: ctx(), summary: 'goal summary' });

    const toolNames = (create.mock.calls[0]![0].tools as { function: { name: string } }[]).map((t) => t.function.name);
    expect(new Set(toolNames)).toEqual(
      new Set(['get_records', 'get_performance_series', 'get_activity_volume', 'list_events', 'propose_plan']),
    );
  });
});

describe('getTrainingPlanAutofill', () => {
  it('summarizes recent volume, records, performance, and non-running load', () => {
    const path = createTrainingPlanAutofillDb({
      activity: [
        { activity_id: '1', type: 'running', start_time_local: '2026-01-05 08:00:00', distance_m: 10000, duration_s: 3000, fastest_5k_s: 1400 },
        { activity_id: '2', type: 'running', start_time_local: '2026-01-12 08:00:00', distance_m: 15000, duration_s: 4800 },
        { activity_id: '3', type: 'cycling', start_time_local: '2026-01-08 08:00:00', distance_m: 30000, duration_s: 4500 },
      ],
      training_status: [{ date: '2026-01-10', vo2max: 50, acute_load: 200, chronic_load: 180, acwr: 1.1 }],
      race_predictions: [{ date: '2026-01-10', race_5k_s: 1350, race_10k_s: 2800, race_half_s: 6200, race_full_s: 13000 }],
      training_readiness: [{ date: '2026-01-10', score: 75 }],
    });
    const db = openDb(path);

    const autofill = getTrainingPlanAutofill(db, '2026-01-15');

    expect(autofill.longestRecentRunKm).toBe(15);
    expect(autofill.vo2max).toBe(50);
    expect(autofill.trainingLoad).toEqual({ acute: 200, chronic: 180, acwr: 1.1 });
    expect(autofill.readinessScore).toBe(75);
    expect(autofill.racePredictions.raceHalfS).toBe(6200);
    const cycling = autofill.nonRunningLoad.find((g) => g.group === 'cycling');
    expect(cycling?.count).toBe(1);
    expect(cycling?.distanceKm).toBe(30);
    expect(autofill.records.some((r) => r.key === 'fastest_5k')).toBe(true);
  });
});
