import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TrainingPlanDetail, TrainingPlanWorkout } from '@fitness/shared';
import { endTrainingPlan } from '../../api';
import PlanReviewPanel from './PlanReviewPanel';
import WorkoutRow from './WorkoutRow';
import { mondayOf } from './workoutFormat';

/** Groups workouts into Monday-start weeks, preserving date order within each. */
function byWeek(workouts: TrainingPlanWorkout[]): [string, TrainingPlanWorkout[]][] {
  const weeks = new Map<string, TrainingPlanWorkout[]>();
  for (const w of workouts) {
    const key = mondayOf(w.date);
    weeks.set(key, [...(weeks.get(key) ?? []), w]);
  }
  return [...weeks.entries()];
}

/** The active plan as a per-week tick-off checklist. */
export default function ActivePlanView({ detail }: { detail: TrainingPlanDetail }) {
  const queryClient = useQueryClient();
  const end = useMutation({
    mutationFn: () => endTrainingPlan(detail.plan.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['training-plans'] }),
  });

  return (
    <>
      <p className="status">
        {detail.plan.goalDescription ? `${detail.plan.goalDescription} — ` : ''}
        {detail.plan.startDate} to {detail.plan.endDate}, {detail.plan.daysPerWeek} days/week.
      </p>
      <div className="controls">
        <button disabled={end.isPending} onClick={() => end.mutate()}>
          End plan
        </button>
      </div>
      <PlanReviewPanel detail={detail} />
      {byWeek(detail.workouts).map(([weekStart, workouts]) => (
        <div key={weekStart}>
          <h3>Week of {weekStart}</h3>
          <table>
            <thead>
              <tr>
                <th>Done</th>
                <th>Date</th>
                <th>Type</th>
                <th>Workout</th>
                <th>Distance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {workouts.map((w) => (
                <WorkoutRow key={w.id} workout={w} />
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
