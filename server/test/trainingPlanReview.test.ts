import { describe, expect, it } from 'vitest';
import { openEventsDb } from '../src/db.js';
import { createTrainingPlan, listWorkouts } from '../src/repositories/trainingPlans.js';
import { applyPlanReview, listPlanRevisions } from '../src/repositories/trainingPlanReview.js';

function db() {
  return openEventsDb(':memory:');
}

const basePlan = {
  goalDescription: 'half marathon',
  startDate: '2026-01-01',
  endDate: '2026-03-01',
  daysPerWeek: 4,
};

describe('applyPlanReview', () => {
  it('applies modify/remove/add transactionally and records a revision', () => {
    const d = db();
    const detail = createTrainingPlan(d, {
      ...basePlan,
      workouts: [
        { date: '2026-01-05', title: 'Easy 5k', workoutType: 'easy', targetDistanceM: 5000 },
        { date: '2026-01-07', title: 'Long run 10k', workoutType: 'long', targetDistanceM: 10000 },
      ],
    });
    const [keep, drop] = detail.workouts;

    const revision = applyPlanReview(d, detail.plan.id, {
      rationale: 'easing back after a tired week',
      modify: [{ workoutId: keep!.id, patch: { targetDistanceM: 4000 }, explanation: 'shorter easy run' }],
      remove: [{ workoutId: drop!.id, explanation: 'dropping the long run this week' }],
      add: [{ date: '2026-01-09', title: 'Recovery jog', workoutType: 'easy', targetDistanceM: 3000, explanation: 'replace volume gently' }],
    });

    const workouts = listWorkouts(d, detail.plan.id);
    expect(workouts).toHaveLength(2);
    expect(workouts.find((w) => w.id === keep!.id)?.targetDistanceM).toBe(4000);
    expect(workouts.find((w) => w.id === drop!.id)).toBeUndefined();
    expect(workouts.some((w) => w.title === 'Recovery jog')).toBe(true);

    expect(revision.rationale).toBe('easing back after a tired week');
    expect(revision.changes).toHaveLength(3);
    const modifyChange = revision.changes.find((c) => c.workoutId === keep!.id);
    expect(modifyChange?.before?.targetDistanceM).toBe(5000);
    expect(modifyChange?.after?.targetDistanceM).toBe(4000);
    const removeChange = revision.changes.find((c) => c.workoutId === drop!.id);
    expect(removeChange?.after).toBeNull();
    const addChange = revision.changes.find((c) => c.before === null && c.after?.title === 'Recovery jog');
    expect(addChange).toBeDefined();

    expect(listPlanRevisions(d, detail.plan.id)).toHaveLength(1);
  });

  it('keeps only the most recent 10 revisions per plan', () => {
    const d = db();
    const detail = createTrainingPlan(d, { ...basePlan, workouts: [{ date: '2026-01-05', title: 'Easy 5k', workoutType: 'easy' }] });

    for (let i = 0; i < 12; i += 1) {
      applyPlanReview(d, detail.plan.id, { rationale: `pass ${i}`, modify: [], remove: [], add: [] });
    }

    const revisions = listPlanRevisions(d, detail.plan.id);
    expect(revisions).toHaveLength(10);
    expect(revisions[0]!.rationale).toBe('pass 11');
    expect(revisions[9]!.rationale).toBe('pass 2');
  });
});
