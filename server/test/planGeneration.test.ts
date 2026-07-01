import { describe, expect, it, vi } from 'vitest';
import { openDb, openEventsDb } from '../src/db.js';
import { PlanGenerationError, generatePlan } from '../src/ai/planGeneration.js';
import type { CompletionClient } from '../src/ai/chat.js';
import { getTrainingPlanAutofill } from '../src/repositories/trainingPlanAutofill.js';
import { createTestDb, createTrainingPlanAutofillDb } from './fixtures.js';

const START = '2026-01-01';
const END = '2026-02-26';

function ctx() {
  return { db: openDb(createTestDb([])), eventsDb: openEventsDb(':memory:') };
}

const validArgs = {
  rationale: 'feasible given current base',
  workouts: [
    { date: '2026-01-05', title: 'Easy 5k', workoutType: 'easy' },
    { date: '2026-01-07', title: 'Long run 10k', workoutType: 'long' },
  ],
};

const raceValidArgs = {
  rationale: 'feasible given current base',
  workouts: [
    { date: '2026-01-05', title: 'Easy 5k', workoutType: 'easy' },
    { date: '2026-01-07', title: 'Long run 10k', workoutType: 'long' },
    { date: END, title: 'Race day', workoutType: 'race' },
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
  it('instructs the model on race-day placement and taper when isRace', async () => {
    const create = vi.fn().mockResolvedValueOnce(proposeCallResponse(raceValidArgs));
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    await generatePlan({ client, model: 'test', ctx: ctx(), summary: 'goal summary', startDate: START, endDate: END, isRace: true });

    const systemMessage = create.mock.calls[0]![0].messages[0].content as string;
    expect(systemMessage).toMatch(/end date is race day/i);
    expect(systemMessage).toMatch(/final 2 days/i);
    expect(systemMessage).toMatch(/at most one tempo and one interval/i);
    expect(systemMessage).toMatch(/name the specific figures/i);
    expect(systemMessage).toContain('goal summary');
  });

  it('describes the pace-range fields so min is the faster/smaller value and max the slower/larger one', async () => {
    const create = vi.fn().mockResolvedValueOnce(proposeCallResponse(validArgs));
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    await generatePlan({ client, model: 'test', ctx: ctx(), summary: 'goal summary', startDate: START, endDate: END, isRace: false });

    const tools = create.mock.calls[0]![0].tools as {
      function: { name: string; parameters: { properties: { workouts: { items: { properties: Record<string, { description?: string }> } } } } };
    }[];
    const workoutProps = tools.find((t) => t.function.name === 'propose_plan')!.function.parameters.properties.workouts.items.properties;
    expect(workoutProps.targetPaceMinSecPerKm!.description).toMatch(/smaller/i);
    expect(workoutProps.targetPaceMinSecPerKm!.description).toMatch(/faster/i);
    expect(workoutProps.targetPaceMaxSecPerKm!.description).toMatch(/larger/i);
    expect(workoutProps.targetPaceMaxSecPerKm!.description).toMatch(/slower/i);
  });

  it('instructs the model that a general-fitness goal needs no taper', async () => {
    const create = vi.fn().mockResolvedValueOnce(proposeCallResponse(validArgs));
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    await generatePlan({ client, model: 'test', ctx: ctx(), summary: 'goal summary', startDate: START, endDate: END, isRace: false });

    const systemMessage = create.mock.calls[0]![0].messages[0].content as string;
    expect(systemMessage).toMatch(/no taper needed/i);
  });

  it('accepts an early propose_plan call before the forced step', async () => {
    const create = vi.fn().mockResolvedValueOnce(proposeCallResponse(validArgs));
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    const plan = await generatePlan({ client, model: 'test', ctx: ctx(), summary: 'goal summary', startDate: START, endDate: END, isRace: false });

    expect(plan.rationale).toBe(validArgs.rationale);
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

    const plan = await generatePlan({ client, model: 'test', ctx: ctx(), summary: 'goal summary', startDate: START, endDate: END, isRace: false });

    expect(plan.rationale).toBe(validArgs.rationale);
    expect(create).toHaveBeenCalledTimes(8);
    for (let i = 0; i < 7; i += 1) {
      expect(create.mock.calls[i]![0].tool_choice).toBe('auto');
      expect(create.mock.calls[i]![0].tools.length).toBeGreaterThan(1);
    }
    expect(create.mock.calls[7]![0].tool_choice).toBe('required');
    const finalTools = create.mock.calls[7]![0].tools as { function: { name: string } }[];
    expect(finalTools.map((t) => t.function.name)).toEqual(['propose_plan']);
  });

  it('continues the loop (with a nudge) instead of accepting free text as an answer', async () => {
    const create = vi.fn().mockResolvedValueOnce(freeTextResponse).mockResolvedValueOnce(proposeCallResponse(validArgs));
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    const plan = await generatePlan({ client, model: 'test', ctx: ctx(), summary: 'goal summary', startDate: START, endDate: END, isRace: false });

    expect(plan.rationale).toBe(validArgs.rationale);
    expect(create).toHaveBeenCalledTimes(2);
    const secondCallMessages = create.mock.calls[1]![0].messages as { role: string; content: string }[];
    expect(secondCallMessages.some((m) => m.role === 'user' && m.content.includes('propose_plan'))).toBe(true);
  });

  it('rejects invalid propose_plan arguments', async () => {
    const create = vi.fn().mockResolvedValueOnce(proposeCallResponse({ ...validArgs, workouts: [{ date: '2026-01-05', title: 'x', workoutType: 'sprint' }] }));
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    await expect(
      generatePlan({ client, model: 'test', ctx: ctx(), summary: 'goal summary', startDate: START, endDate: END, isRace: false }),
    ).rejects.toThrow(PlanGenerationError);
  });

  it('throws when the model never produces a valid propose_plan call', async () => {
    const create = vi.fn().mockResolvedValue(freeTextResponse);
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    await expect(
      generatePlan({ client, model: 'test', ctx: ctx(), summary: 'goal summary', startDate: START, endDate: END, isRace: false }),
    ).rejects.toThrow(PlanGenerationError);
    expect(create).toHaveBeenCalledTimes(8);
  });

  it('throws a clean PlanGenerationError rather than crashing on a malformed provider response', async () => {
    const create = vi.fn().mockResolvedValueOnce({}); // no `choices` at all
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    await expect(
      generatePlan({ client, model: 'test', ctx: ctx(), summary: 'goal summary', startDate: START, endDate: END, isRace: false }),
    ).rejects.toThrow(PlanGenerationError);
  });

  it('only offers a small, plan-relevant subset of tools, not the full chat toolset', async () => {
    const create = vi.fn().mockResolvedValueOnce(proposeCallResponse(validArgs));
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    await generatePlan({ client, model: 'test', ctx: ctx(), summary: 'goal summary', startDate: START, endDate: END, isRace: false });

    const toolNames = (create.mock.calls[0]![0].tools as { function: { name: string } }[]).map((t) => t.function.name);
    expect(new Set(toolNames)).toEqual(
      new Set(['get_records', 'get_performance_series', 'get_activity_volume', 'list_events', 'propose_plan']),
    );
  });

  it('rejects a workout dated outside the plan window', async () => {
    const args = { rationale: 'x', workouts: [{ date: '2025-12-31', title: 'Too early', workoutType: 'easy' }] };
    const create = vi.fn().mockResolvedValueOnce(proposeCallResponse(args));
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    await expect(
      generatePlan({ client, model: 'test', ctx: ctx(), summary: 'goal summary', startDate: START, endDate: END, isRace: false }),
    ).rejects.toThrow(PlanGenerationError);
  });

  it('rejects a race plan whose race workout is missing or not on the race date', async () => {
    const create = vi.fn().mockResolvedValueOnce(proposeCallResponse(validArgs)); // no race row at all
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    await expect(
      generatePlan({ client, model: 'test', ctx: ctx(), summary: 'goal summary', startDate: START, endDate: END, isRace: true }),
    ).rejects.toThrow(PlanGenerationError);
  });

  it('rejects a hard/long session in the final 2 days before race day', async () => {
    const args = {
      rationale: 'x',
      workouts: [
        { date: '2026-02-25', title: 'Tempo run', workoutType: 'tempo', description: 'threshold pace for 20 minutes' },
        { date: END, title: 'Race day', workoutType: 'race' },
      ],
    };
    const create = vi.fn().mockResolvedValueOnce(proposeCallResponse(args));
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    await expect(
      generatePlan({ client, model: 'test', ctx: ctx(), summary: 'goal summary', startDate: START, endDate: END, isRace: true }),
    ).rejects.toThrow(PlanGenerationError);
  });
});

describe('getTrainingPlanAutofill', () => {
  it('summarizes recent volume (zero-filled), representative runs, performance, and non-running load', () => {
    const path = createTrainingPlanAutofillDb({
      activity: [
        { activity_id: '1', type: 'running', start_time_local: '2026-01-05 08:00:00', distance_m: 10000, duration_s: 3000, fastest_5k_s: 1400 },
        { activity_id: '2', type: 'trail_running', start_time_local: '2026-01-12 08:00:00', distance_m: 15000, duration_s: 4800, elevation_gain_m: 320 },
        { activity_id: '3', type: 'cycling', start_time_local: '2026-01-08 08:00:00', distance_m: 30000, duration_s: 4500 },
      ],
      training_status: [{ date: '2026-01-10', vo2max: 50, acute_load: 200, chronic_load: 180, acwr: 1.1 }],
      race_predictions: [{ date: '2026-01-10', race_5k_s: 1350, race_10k_s: 2800, race_half_s: 6200, race_full_s: 13000 }],
      training_readiness: [{ date: '2026-01-10', score: 75 }],
    });
    const db = openDb(path);

    const autofill = getTrainingPlanAutofill(db, '2026-01-15');

    // 6 complete calendar weeks, zero-filled — never sparse.
    expect(autofill.weeklyVolumeTrend).toHaveLength(6);
    expect(autofill.weeklyVolumeTrend.some((w) => w.distanceKm > 0)).toBe(true);
    expect(autofill.weeklyVolumeAvgKm).not.toBeNull();

    expect(autofill.longestRecentRunKm).toBe(15);
    expect(autofill.representativeRuns.length).toBeGreaterThan(0);
    const longestRun = autofill.representativeRuns.find((r) => r.label === 'longest');
    expect(longestRun?.distanceKm).toBe(15);
    expect(longestRun?.type).toBe('trail_running');
    expect(longestRun?.elevationGainM).toBe(320);

    expect(autofill.vo2max).toBe(50);
    expect(autofill.trainingLoad.acute).toBe(200);
    expect(autofill.trainingLoad.chronic).toBe(180);
    expect(autofill.trainingLoad.acwr).toBe(1.1);
    expect(autofill.trainingLoad.acwrTrend).toContain(1.1);
    expect(autofill.readinessScore).toBe(75);
    expect(autofill.racePredictions.raceHalfS).toBe(6200);
    const cycling = autofill.nonRunningLoad.find((g) => g.group === 'cycling');
    expect(cycling?.count).toBe(1);
    expect(cycling?.distanceKm).toBe(30);
  });
});
