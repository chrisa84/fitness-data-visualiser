import type { Database } from 'better-sqlite3';
import type {
  TrainingPlan,
  TrainingPlanDetail,
  TrainingPlanInput,
  TrainingPlanStatus,
  TrainingPlanWorkout,
  TrainingPlanWorkoutInput,
  TrainingPlanWorkoutUpdate,
  WorkoutType,
} from '@fitness/shared';

/** Thrown by `createTrainingPlan` when a plan is already active — end it first. */
export class ActivePlanExistsError extends Error {
  constructor() {
    super('a training plan is already active');
  }
}

function mapPlan(r: Record<string, unknown>): TrainingPlan {
  return {
    id: r.id as number,
    goalDescription: r.goal_description as string,
    isRace: Boolean(r.is_race),
    goalRaceDistanceM: (r.goal_race_distance_m as number | null) ?? null,
    goalTargetDurationS: (r.goal_target_duration_s as number | null) ?? null,
    startDate: r.start_date as string,
    endDate: r.end_date as string,
    daysPerWeek: r.days_per_week as number,
    status: r.status as TrainingPlanStatus,
    createdAt: r.created_at as string,
    endedAt: (r.ended_at as string | null) ?? null,
  };
}

function mapWorkout(r: Record<string, unknown>): TrainingPlanWorkout {
  return {
    id: r.id as number,
    planId: r.plan_id as number,
    date: r.date as string,
    title: r.title as string,
    description: (r.description as string | null) ?? null,
    workoutType: r.workout_type as WorkoutType,
    targetDistanceM: (r.target_distance_m as number | null) ?? null,
    targetDurationS: (r.target_duration_s as number | null) ?? null,
    targetPaceSecPerKm: (r.target_pace_sec_per_km as number | null) ?? null,
    completedAt: (r.completed_at as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

export function listTrainingPlans(db: Database, status?: TrainingPlanStatus): TrainingPlan[] {
  const sql = status
    ? 'SELECT * FROM training_plan WHERE status = ? ORDER BY start_date DESC'
    : 'SELECT * FROM training_plan ORDER BY start_date DESC';
  const rows = (status ? db.prepare(sql).all(status) : db.prepare(sql).all()) as Record<string, unknown>[];
  return rows.map(mapPlan);
}

export function getTrainingPlan(db: Database, id: number): TrainingPlan | null {
  const row = db.prepare('SELECT * FROM training_plan WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapPlan(row) : null;
}

export function getActiveTrainingPlan(db: Database): TrainingPlan | null {
  const row = db.prepare("SELECT * FROM training_plan WHERE status = 'active' LIMIT 1").get() as
    | Record<string, unknown>
    | undefined;
  return row ? mapPlan(row) : null;
}

export function listWorkouts(db: Database, planId: number): TrainingPlanWorkout[] {
  const rows = db
    .prepare('SELECT * FROM training_plan_workout WHERE plan_id = ? ORDER BY date')
    .all(planId) as Record<string, unknown>[];
  return rows.map(mapWorkout);
}

export function getTrainingPlanDetail(db: Database, id: number): TrainingPlanDetail | null {
  const plan = getTrainingPlan(db, id);
  if (!plan) return null;
  return { plan, workouts: listWorkouts(db, id) };
}

function insertWorkout(db: Database, planId: number, input: TrainingPlanWorkoutInput): TrainingPlanWorkout {
  const info = db
    .prepare(
      `INSERT INTO training_plan_workout
         (plan_id, date, title, description, workout_type, target_distance_m,
          target_duration_s, target_pace_sec_per_km, notes, created_at)
       VALUES (@planId, @date, @title, @description, @workoutType, @targetDistanceM,
               @targetDurationS, @targetPaceSecPerKm, @notes, @createdAt)`,
    )
    .run({
      planId,
      date: input.date,
      title: input.title,
      description: input.description ?? null,
      workoutType: input.workoutType,
      targetDistanceM: input.targetDistanceM ?? null,
      targetDurationS: input.targetDurationS ?? null,
      targetPaceSecPerKm: input.targetPaceSecPerKm ?? null,
      notes: input.notes ?? null,
      createdAt: new Date().toISOString(),
    });
  return getWorkout(db, Number(info.lastInsertRowid))!;
}

export function createTrainingPlan(db: Database, input: TrainingPlanInput): TrainingPlanDetail {
  if (getActiveTrainingPlan(db)) throw new ActivePlanExistsError();

  const createPlan = db.transaction((planInput: TrainingPlanInput) => {
    const info = db
      .prepare(
        `INSERT INTO training_plan
           (goal_description, is_race, goal_race_distance_m, goal_target_duration_s,
            start_date, end_date, days_per_week, status, created_at)
         VALUES (@goalDescription, @isRace, @goalRaceDistanceM, @goalTargetDurationS,
                 @startDate, @endDate, @daysPerWeek, 'active', @createdAt)`,
      )
      .run({
        goalDescription: planInput.goalDescription,
        isRace: planInput.isRace ? 1 : 0,
        goalRaceDistanceM: planInput.goalRaceDistanceM ?? null,
        goalTargetDurationS: planInput.goalTargetDurationS ?? null,
        startDate: planInput.startDate,
        endDate: planInput.endDate,
        daysPerWeek: planInput.daysPerWeek,
        createdAt: new Date().toISOString(),
      });
    const planId = Number(info.lastInsertRowid);
    for (const workout of planInput.workouts ?? []) {
      insertWorkout(db, planId, workout);
    }
    return planId;
  });

  const planId = createPlan(input);
  return getTrainingPlanDetail(db, planId)!;
}

export function endTrainingPlan(db: Database, id: number): TrainingPlan | null {
  const existing = getTrainingPlan(db, id);
  if (!existing) return null;
  if (existing.status === 'ended') return existing;
  db.prepare("UPDATE training_plan SET status = 'ended', ended_at = @endedAt WHERE id = @id").run({
    id,
    endedAt: new Date().toISOString(),
  });
  return getTrainingPlan(db, id);
}

export function deleteTrainingPlan(db: Database, id: number): boolean {
  const deletePlan = db.transaction((planId: number) => {
    db.prepare('DELETE FROM training_plan_workout WHERE plan_id = ?').run(planId);
    return db.prepare('DELETE FROM training_plan WHERE id = ?').run(planId).changes > 0;
  });
  return deletePlan(id);
}

export function getWorkout(db: Database, id: number): TrainingPlanWorkout | null {
  const row = db.prepare('SELECT * FROM training_plan_workout WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapWorkout(row) : null;
}

export function createWorkout(
  db: Database,
  planId: number,
  input: TrainingPlanWorkoutInput,
): TrainingPlanWorkout | null {
  if (!getTrainingPlan(db, planId)) return null;
  return insertWorkout(db, planId, input);
}

export function updateWorkout(
  db: Database,
  id: number,
  input: TrainingPlanWorkoutUpdate,
): TrainingPlanWorkout | null {
  const existing = getWorkout(db, id);
  if (!existing) return null;
  const merged = { ...existing, ...input };
  db.prepare(
    `UPDATE training_plan_workout
     SET date = @date, title = @title, description = @description, workout_type = @workoutType,
         target_distance_m = @targetDistanceM, target_duration_s = @targetDurationS,
         target_pace_sec_per_km = @targetPaceSecPerKm, notes = @notes, completed_at = @completedAt
     WHERE id = @id`,
  ).run({
    id,
    date: merged.date,
    title: merged.title,
    description: merged.description ?? null,
    workoutType: merged.workoutType,
    targetDistanceM: merged.targetDistanceM ?? null,
    targetDurationS: merged.targetDurationS ?? null,
    targetPaceSecPerKm: merged.targetPaceSecPerKm ?? null,
    notes: merged.notes ?? null,
    completedAt: merged.completedAt ?? null,
  });
  return getWorkout(db, id);
}

export function deleteWorkout(db: Database, id: number): boolean {
  return db.prepare('DELETE FROM training_plan_workout WHERE id = ?').run(id).changes > 0;
}
