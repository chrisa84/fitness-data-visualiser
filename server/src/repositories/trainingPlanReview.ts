import type { Database } from 'better-sqlite3';
import type {
  ApplyPlanReviewRequest,
  TrainingPlanRevision,
  TrainingPlanRevisionChange,
} from '@fitness/shared';
import { createWorkout, deleteWorkout, getWorkout, updateWorkout } from './trainingPlans.js';

/** Keep only the most recent revisions per plan — a small history, not a full audit log. */
const MAX_REVISIONS_PER_PLAN = 10;

function mapRevision(r: Record<string, unknown>): TrainingPlanRevision {
  return {
    id: r.id as number,
    planId: r.plan_id as number,
    createdAt: r.created_at as string,
    rationale: r.rationale as string,
    changes: JSON.parse(r.changes_json as string) as TrainingPlanRevisionChange[],
  };
}

export function listPlanRevisions(db: Database, planId: number): TrainingPlanRevision[] {
  const rows = db
    .prepare('SELECT * FROM training_plan_revision WHERE plan_id = ? ORDER BY id DESC')
    .all(planId) as Record<string, unknown>[];
  return rows.map(mapRevision);
}

/**
 * Applies exactly the accepted subset of a proposed adjustment in one
 * transaction, and records a revision row with before/after values plus the
 * model's rationale. Callers must have already re-run `validateProposedAdjustment`
 * against fresh plan state — this function does not re-check hard protections,
 * it only writes what it's given.
 */
export function applyPlanReview(
  db: Database,
  planId: number,
  request: ApplyPlanReviewRequest,
): TrainingPlanRevision {
  const apply = db.transaction(() => {
    const changes: TrainingPlanRevisionChange[] = [];

    for (const m of request.modify) {
      const before = getWorkout(db, m.workoutId);
      const after = updateWorkout(db, m.workoutId, m.patch);
      changes.push({ workoutId: m.workoutId, before, after, explanation: m.explanation });
    }
    for (const r of request.remove) {
      const before = getWorkout(db, r.workoutId);
      deleteWorkout(db, r.workoutId);
      changes.push({ workoutId: r.workoutId, before, after: null, explanation: r.explanation });
    }
    for (const a of request.add) {
      const { explanation, ...input } = a;
      const after = createWorkout(db, planId, input);
      changes.push({ workoutId: after?.id ?? null, before: null, after, explanation });
    }

    const info = db
      .prepare(
        `INSERT INTO training_plan_revision (plan_id, created_at, rationale, changes_json)
         VALUES (@planId, @createdAt, @rationale, @changesJson)`,
      )
      .run({ planId, createdAt: new Date().toISOString(), rationale: request.rationale, changesJson: JSON.stringify(changes) });

    db.prepare(
      `DELETE FROM training_plan_revision
       WHERE plan_id = @planId
         AND id NOT IN (SELECT id FROM training_plan_revision WHERE plan_id = @planId ORDER BY id DESC LIMIT @keep)`,
    ).run({ planId, keep: MAX_REVISIONS_PER_PLAN });

    return Number(info.lastInsertRowid);
  });

  const revisionId = apply();
  return mapRevision(
    db.prepare('SELECT * FROM training_plan_revision WHERE id = ?').get(revisionId) as Record<string, unknown>,
  );
}
