import { describe, expect, it, vi } from 'vitest';
import type { TrainingPlan, TrainingPlanWorkout } from '@fitness/shared';
import { PlanReviewError, reviewPlan, validateProposedAdjustment } from '../src/ai/planReview.js';
import type { CompletionClient } from '../src/ai/chat.js';
import { openDb, openEventsDb } from '../src/db.js';
import { createTestDb } from './fixtures.js';

function ctx() {
  return { db: openDb(createTestDb([])), eventsDb: openEventsDb(':memory:') };
}

function plan(overrides: Partial<TrainingPlan> = {}): TrainingPlan {
  return {
    id: 1,
    goalDescription: 'half marathon',
    isRace: false,
    goalRaceDistanceM: null,
    goalTargetDurationS: null,
    startDate: '2026-01-01',
    endDate: '2026-02-26',
    daysPerWeek: 4,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    endedAt: null,
    ...overrides,
  };
}

function workout(overrides: Partial<TrainingPlanWorkout> & { id: number; date: string }): TrainingPlanWorkout {
  return {
    planId: 1,
    title: 'Easy run',
    description: null,
    workoutType: 'easy',
    targetDistanceM: 5000,
    targetDurationS: null,
    targetPaceSecPerKm: null,
    targetPaceMinSecPerKm: null,
    targetPaceMaxSecPerKm: null,
    completedAt: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const emptyAdjustment = { overallAssessment: '', adjustmentReason: '', modify: [], remove: [], add: [] };

function proposeCallResponse(args: unknown) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'p1', type: 'function', function: { name: 'propose_plan_adjustment', arguments: JSON.stringify(args) } }],
        },
      },
    ],
  };
}

const freeTextResponse = { choices: [{ message: { role: 'assistant', content: 'thinking…' } }] };

describe('reviewPlan', () => {
  it('accepts an early propose_plan_adjustment call before the forced step', async () => {
    const args = { ...emptyAdjustment, overallAssessment: 'on track', adjustmentReason: 'no changes needed' };
    const create = vi.fn().mockResolvedValueOnce(proposeCallResponse(args));
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    const adjustment = await reviewPlan({ client, model: 'test', ctx: ctx(), summary: 'review summary', isRace: false });

    expect(adjustment.overallAssessment).toBe('on track');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].tool_choice).toBe('auto');
  });

  it('forces tool_choice to propose_plan_adjustment on the final allowed step', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(freeTextResponse)
      .mockResolvedValueOnce(freeTextResponse)
      .mockResolvedValueOnce(freeTextResponse)
      .mockResolvedValueOnce(freeTextResponse)
      .mockResolvedValueOnce(freeTextResponse)
      .mockResolvedValueOnce(freeTextResponse)
      .mockResolvedValueOnce(freeTextResponse)
      .mockResolvedValueOnce(proposeCallResponse(emptyAdjustment));
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    await reviewPlan({ client, model: 'test', ctx: ctx(), summary: 'review summary', isRace: false });

    expect(create).toHaveBeenCalledTimes(8);
    expect(create.mock.calls[7]![0].tool_choice).toBe('required');
    const finalTools = create.mock.calls[7]![0].tools as { function: { name: string } }[];
    expect(finalTools.map((t) => t.function.name)).toEqual(['propose_plan_adjustment']);
  });

  it('sends the ephemeral notes as part of the system prompt, not a separate persisted field', async () => {
    const create = vi.fn().mockResolvedValueOnce(proposeCallResponse(emptyAdjustment));
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    await reviewPlan({ client, model: 'test', ctx: ctx(), summary: 'review summary', isRace: false, notes: 'tight on time this week' });

    const systemMessage = create.mock.calls[0]![0].messages[0].content as string;
    expect(systemMessage).toContain('tight on time this week');
  });

  it('rejects invalid propose_plan_adjustment arguments', async () => {
    const create = vi.fn().mockResolvedValueOnce(proposeCallResponse({ modify: [], remove: [], add: [] })); // missing required fields
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    await expect(
      reviewPlan({ client, model: 'test', ctx: ctx(), summary: 'review summary', isRace: false }),
    ).rejects.toThrow(PlanReviewError);
  });

  it('throws when the model never produces a valid propose_plan_adjustment call', async () => {
    const create = vi.fn().mockResolvedValue(freeTextResponse);
    const client = { chat: { completions: { create } } } as unknown as CompletionClient;

    await expect(
      reviewPlan({ client, model: 'test', ctx: ctx(), summary: 'review summary', isRace: false }),
    ).rejects.toThrow(PlanReviewError);
    expect(create).toHaveBeenCalledTimes(8);
  });
});

describe('validateProposedAdjustment', () => {
  const today = '2026-01-15';
  const scopeStart = today;
  const scopeEnd = '2026-01-21';
  const workouts = [
    workout({ id: 1, date: '2026-01-10', completedAt: '2026-01-10T08:00:00.000Z' }), // past, completed
    workout({ id: 2, date: '2026-01-12', completedAt: null }), // past, missed
    workout({ id: 3, date: '2026-01-16', completedAt: null }), // future, in scope
    workout({ id: 4, date: '2026-01-25', completedAt: null }), // future, out of next-week scope
  ];

  it('allows a valid modify within scope', () => {
    expect(() =>
      validateProposedAdjustment({
        plan: plan(),
        workouts,
        scopeStart,
        scopeEnd,
        adjustment: { ...emptyAdjustment, modify: [{ workoutId: 3, patch: { targetDistanceM: 4000 }, explanation: 'easing back' }] },
      }),
    ).not.toThrow();
  });

  it('rejects modifying a completed workout', () => {
    expect(() =>
      validateProposedAdjustment({
        plan: plan(),
        workouts,
        scopeStart,
        scopeEnd,
        adjustment: { ...emptyAdjustment, modify: [{ workoutId: 1, patch: { targetDistanceM: 4000 }, explanation: 'x' }] },
      }),
    ).toThrow(PlanReviewError);
  });

  it('rejects modifying a past, missed workout (still not touchable, protects history)', () => {
    expect(() =>
      validateProposedAdjustment({
        plan: plan(),
        workouts,
        scopeStart,
        scopeEnd,
        adjustment: { ...emptyAdjustment, modify: [{ workoutId: 2, patch: { targetDistanceM: 4000 }, explanation: 'x' }] },
      }),
    ).toThrow(PlanReviewError);
  });

  it('rejects touching a workout outside the reviewed scope window', () => {
    expect(() =>
      validateProposedAdjustment({
        plan: plan(),
        workouts,
        scopeStart,
        scopeEnd,
        adjustment: { ...emptyAdjustment, remove: [{ workoutId: 4, explanation: 'x' }] },
      }),
    ).toThrow(PlanReviewError);
  });

  it('rejects modifying or removing the race-day workout', () => {
    const withRace = [...workouts, workout({ id: 5, date: scopeEnd, workoutType: 'race', targetDistanceM: null })];
    expect(() =>
      validateProposedAdjustment({
        plan: plan({ isRace: true, endDate: scopeEnd }),
        workouts: withRace,
        scopeStart,
        scopeEnd,
        adjustment: { ...emptyAdjustment, remove: [{ workoutId: 5, explanation: 'x' }] },
      }),
    ).toThrow(PlanReviewError);
  });

  it('rejects a patch that changes a workout to type race', () => {
    expect(() =>
      validateProposedAdjustment({
        plan: plan(),
        workouts,
        scopeStart,
        scopeEnd,
        adjustment: { ...emptyAdjustment, modify: [{ workoutId: 3, patch: { workoutType: 'race' }, explanation: 'x' }] },
      }),
    ).toThrow(PlanReviewError);
  });

  it('rejects an added workout dated outside the reviewed scope', () => {
    expect(() =>
      validateProposedAdjustment({
        plan: plan(),
        workouts,
        scopeStart,
        scopeEnd,
        adjustment: { ...emptyAdjustment, add: [{ date: '2026-02-01', title: 'Extra run', workoutType: 'easy', explanation: 'x' }] },
      }),
    ).toThrow(PlanReviewError);
  });

  it('rejects adding a new race-day workout', () => {
    expect(() =>
      validateProposedAdjustment({
        plan: plan(),
        workouts,
        scopeStart,
        scopeEnd,
        adjustment: { ...emptyAdjustment, add: [{ date: scopeStart, title: 'Surprise race', workoutType: 'race', explanation: 'x' }] },
      }),
    ).toThrow(PlanReviewError);
  });

  it('rejects a modify whose merged result breaks an existing invariant (pace order)', () => {
    expect(() =>
      validateProposedAdjustment({
        plan: plan(),
        workouts,
        scopeStart,
        scopeEnd,
        adjustment: {
          ...emptyAdjustment,
          modify: [{ workoutId: 3, patch: { targetPaceMinSecPerKm: 300, targetPaceMaxSecPerKm: 250 }, explanation: 'x' }],
        },
      }),
    ).toThrow(PlanReviewError);
  });

  it('rejects an added tempo workout without a meaningful description', () => {
    expect(() =>
      validateProposedAdjustment({
        plan: plan(),
        workouts,
        scopeStart,
        scopeEnd,
        adjustment: { ...emptyAdjustment, add: [{ date: scopeStart, title: 'Tempo', workoutType: 'tempo', explanation: 'x' }] },
      }),
    ).toThrow(PlanReviewError);
  });

  it('rejects a hard/long session added in the final 2 days before race day', () => {
    const racePlan = plan({ isRace: true, endDate: '2026-01-21' });
    expect(() =>
      validateProposedAdjustment({
        plan: racePlan,
        workouts,
        scopeStart,
        scopeEnd: racePlan.endDate,
        adjustment: {
          ...emptyAdjustment,
          add: [{ date: '2026-01-20', title: 'Tempo', workoutType: 'tempo', description: 'threshold pace for 20 minutes', explanation: 'x' }],
        },
      }),
    ).toThrow(PlanReviewError);
  });
});
