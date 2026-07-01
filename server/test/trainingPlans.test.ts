import { describe, expect, it } from 'vitest';
import { openEventsDb } from '../src/db.js';
import {
  ActivePlanExistsError,
  createTrainingPlan,
  createWorkout,
  deleteTrainingPlan,
  deleteWorkout,
  endTrainingPlan,
  getActiveTrainingPlan,
  getTrainingPlanDetail,
  listTrainingPlans,
  updateWorkout,
  WorkoutValidationError,
} from '../src/repositories/trainingPlans.js';

function db() {
  return openEventsDb(':memory:');
}

const basePlan = {
  goalDescription: 'half marathon in 1:50',
  startDate: '2026-01-01',
  endDate: '2026-03-01',
  daysPerWeek: 4,
  isRace: true,
  goalRaceDistanceM: 21097,
  goalTargetDurationS: 6600,
};

describe('training plan repository', () => {
  it('creates a plan with embedded workouts and reads it back', () => {
    const d = db();
    const detail = createTrainingPlan(d, {
      ...basePlan,
      workouts: [
        { date: '2026-01-05', title: 'Easy 5k', workoutType: 'easy' },
        { date: '2026-01-07', title: 'Long run 10k', workoutType: 'long' },
      ],
    });
    expect(detail.plan.status).toBe('active');
    expect(detail.plan.isRace).toBe(true);
    expect(detail.workouts.map((w) => w.title)).toEqual(['Easy 5k', 'Long run 10k']);
    expect(getTrainingPlanDetail(d, detail.plan.id)).toEqual(detail);
  });

  it('rejects creating a second active plan until the first ends', () => {
    const d = db();
    const first = createTrainingPlan(d, basePlan);
    expect(() => createTrainingPlan(d, basePlan)).toThrow(ActivePlanExistsError);

    endTrainingPlan(d, first.plan.id);
    expect(getActiveTrainingPlan(d)).toBeNull();
    expect(() => createTrainingPlan(d, basePlan)).not.toThrow();
  });

  it('ending a plan is idempotent', () => {
    const d = db();
    const { plan } = createTrainingPlan(d, basePlan);
    const ended = endTrainingPlan(d, plan.id);
    const endedAgain = endTrainingPlan(d, plan.id);
    expect(ended?.status).toBe('ended');
    expect(endedAgain?.endedAt).toBe(ended?.endedAt);
  });

  it('returns null for an unknown plan id', () => {
    expect(getTrainingPlanDetail(db(), 999)).toBeNull();
    expect(endTrainingPlan(db(), 999)).toBeNull();
  });

  it('lists plans filtered by status', () => {
    const d = db();
    const { plan } = createTrainingPlan(d, basePlan);
    endTrainingPlan(d, plan.id);
    createTrainingPlan(d, basePlan);
    expect(listTrainingPlans(d, 'ended')).toHaveLength(1);
    expect(listTrainingPlans(d, 'active')).toHaveLength(1);
    expect(listTrainingPlans(d)).toHaveLength(2);
  });

  it('creates, ticks, edits, and deletes a workout', () => {
    const d = db();
    const { plan } = createTrainingPlan(d, basePlan);
    const workout = createWorkout(d, plan.id, { date: '2026-01-05', title: 'Easy 5k', workoutType: 'easy' });
    expect(workout?.completedAt).toBeNull();

    const ticked = updateWorkout(d, workout!.id, { completedAt: '2026-01-05T08:00:00Z' });
    expect(ticked?.completedAt).toBe('2026-01-05T08:00:00Z');

    const edited = updateWorkout(d, workout!.id, { title: 'Easy 6k' });
    expect(edited?.title).toBe('Easy 6k');
    expect(edited?.completedAt).toBe('2026-01-05T08:00:00Z');

    expect(deleteWorkout(d, workout!.id)).toBe(true);
    expect(deleteWorkout(d, workout!.id)).toBe(false);
  });

  it('rejects an update that would move a workout outside the plan window', () => {
    const d = db();
    const { plan } = createTrainingPlan(d, basePlan);
    const workout = createWorkout(d, plan.id, { date: '2026-01-05', title: 'Easy 5k', workoutType: 'easy' });
    expect(() => updateWorkout(d, workout!.id, { date: '2025-12-31' })).toThrow(WorkoutValidationError);
  });

  it('rejects an update with an inverted pace range', () => {
    const d = db();
    const { plan } = createTrainingPlan(d, basePlan);
    const workout = createWorkout(d, plan.id, { date: '2026-01-05', title: 'Easy 5k', workoutType: 'easy' });
    expect(() =>
      updateWorkout(d, workout!.id, { targetPaceMinSecPerKm: 330, targetPaceMaxSecPerKm: 300 }),
    ).toThrow(WorkoutValidationError);
  });

  it('rejects switching a workout to tempo/interval without a meaningful description', () => {
    const d = db();
    const { plan } = createTrainingPlan(d, basePlan);
    const workout = createWorkout(d, plan.id, { date: '2026-01-05', title: 'Easy 5k', workoutType: 'easy' });
    expect(() => updateWorkout(d, workout!.id, { workoutType: 'interval' })).toThrow(WorkoutValidationError);
    expect(
      updateWorkout(d, workout!.id, { workoutType: 'interval', description: '6x800m @ 5k pace, 3min jog recovery' })
        ?.workoutType,
    ).toBe('interval');
  });

  it('returns null creating a workout under a missing plan', () => {
    expect(createWorkout(db(), 999, { date: '2026-01-05', title: 'x', workoutType: 'easy' })).toBeNull();
  });

  it('deleting a plan cascades its workouts', () => {
    const d = db();
    const { plan } = createTrainingPlan(d, {
      ...basePlan,
      workouts: [{ date: '2026-01-05', title: 'Easy 5k', workoutType: 'easy' }],
    });
    expect(deleteTrainingPlan(d, plan.id)).toBe(true);
    expect(getTrainingPlanDetail(d, plan.id)).toBeNull();
    expect(deleteTrainingPlan(d, plan.id)).toBe(false);
  });
});
