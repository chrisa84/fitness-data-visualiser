import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  PlanReviewFeeling,
  PlanReviewScope,
  ProposedPlanAdjustment,
  ProposedWorkoutAddition,
  ProposedWorkoutModification,
  ProposedWorkoutRemoval,
  TrainingPlanDetail,
} from '@fitness/shared';
import { useState } from 'react';
import { applyPlanReview, reviewTrainingPlan } from '../../api';
import { summarizeWorkoutLine } from './workoutFormat';

/**
 * "Ask AI to review my plan": an intake form, then a per-row diff with
 * pre-checked accept/discard boxes. Nothing is written until the user applies,
 * and only the checked rows are sent — the server re-validates them anyway.
 */

type ReviewItemKey = `modify:${number}` | `remove:${number}` | `add:${number}`;

/** Every proposed change, keyed so a checkbox map can address them uniformly. */
function itemKeys(proposal: ProposedPlanAdjustment): ReviewItemKey[] {
  return [
    ...proposal.modify.map((m): ReviewItemKey => `modify:${m.workoutId}`),
    ...proposal.remove.map((r): ReviewItemKey => `remove:${r.workoutId}`),
    ...proposal.add.map((_, i): ReviewItemKey => `add:${i}`),
  ];
}

function DiffRow({
  itemKey,
  before,
  after,
  explanation,
  checked,
  onToggle,
}: {
  itemKey: ReviewItemKey;
  before: string;
  after: string;
  explanation: string;
  checked: boolean;
  onToggle: (value: boolean) => void;
}) {
  return (
    <tr key={itemKey}>
      <td>
        <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
      </td>
      <td>{before}</td>
      <td>{after}</td>
      <td>{explanation}</td>
    </tr>
  );
}

export default function PlanReviewPanel({ detail }: { detail: TrainingPlanDetail }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<PlanReviewScope>('next-week');
  const [feeling, setFeeling] = useState<PlanReviewFeeling>('good');
  const [notes, setNotes] = useState('');
  const [proposal, setProposal] = useState<ProposedPlanAdjustment | null>(null);
  const [checked, setChecked] = useState<Record<ReviewItemKey, boolean>>(
    {} as Record<ReviewItemKey, boolean>,
  );

  const workoutById = new Map(detail.workouts.map((w) => [w.id, w]));

  const setAll = (proposalToSet: ProposedPlanAdjustment, value: boolean) => {
    const next = {} as Record<ReviewItemKey, boolean>;
    for (const key of itemKeys(proposalToSet)) next[key] = value;
    setChecked(next);
  };

  const review = useMutation({
    mutationFn: () =>
      reviewTrainingPlan(detail.plan.id, { scope, feeling, notes: notes || undefined }),
    onSuccess: (p) => {
      setProposal(p);
      setAll(p, true);
    },
  });

  const apply = useMutation({
    mutationFn: () => {
      const p = proposal!;
      return applyPlanReview(detail.plan.id, {
        rationale: p.adjustmentReason,
        modify: p.modify.filter((m) => checked[`modify:${m.workoutId}`]),
        remove: p.remove.filter((r) => checked[`remove:${r.workoutId}`]),
        add: p.add.filter((_, i) => checked[`add:${i}`]),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['training-plans'] });
      setProposal(null);
      setOpen(false);
    },
  });

  const hasChanges =
    proposal != null &&
    (proposal.modify.length > 0 || proposal.remove.length > 0 || proposal.add.length > 0);
  const anyChecked = Object.values(checked).some(Boolean);

  if (!open) {
    return (
      <div className="controls">
        <button onClick={() => setOpen(true)}>Ask AI to review my plan</button>
      </div>
    );
  }

  return (
    <div className="settings-card">
      <h3>Ask AI to review my plan</h3>
      {!proposal && (
        <>
          <div className="controls">
            <label>
              <input
                type="radio"
                checked={scope === 'next-week'}
                onChange={() => setScope('next-week')}
              />{' '}
              Review next week
            </label>
            <label>
              <input
                type="radio"
                checked={scope === 'remaining'}
                onChange={() => setScope('remaining')}
              />{' '}
              Review the remaining plan
            </label>
          </div>
          <div className="controls">
            <label>
              feeling{' '}
              <select value={feeling} onChange={(e) => setFeeling(e.target.value as PlanReviewFeeling)}>
                <option value="good">good</option>
                <option value="tired">tired</option>
                <option value="struggling">struggling</option>
                <option value="injured">injured</option>
              </select>
            </label>
          </div>
          <div className="controls" style={{ display: 'block' }}>
            <label style={{ display: 'block', width: '100%' }}>
              Anything about your schedule or an injury we should know? (optional, used for this
              review only)
              <br />
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                style={{ width: '100%', maxWidth: 500, boxSizing: 'border-box' }}
              />
            </label>
          </div>
          <div className="controls">
            <button disabled={review.isPending} onClick={() => review.mutate()}>
              Review
            </button>
            <button onClick={() => setOpen(false)}>Cancel</button>
            {review.error && (
              <span className="status">Failed to review: {(review.error as Error).message}</span>
            )}
          </div>
        </>
      )}

      {proposal && (
        <>
          <p className="status">{proposal.overallAssessment}</p>
          <p className="status">{proposal.adjustmentReason}</p>

          {!hasChanges && <p className="status">No changes proposed — the plan looks on track.</p>}

          {hasChanges && (
            <>
              <div className="controls">
                <button onClick={() => setAll(proposal, true)}>Accept all</button>
                <button onClick={() => setAll(proposal, false)}>Discard all</button>
              </div>
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>Before</th>
                    <th>After</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {proposal.modify.map((m: ProposedWorkoutModification) => {
                    const before = workoutById.get(m.workoutId);
                    const key: ReviewItemKey = `modify:${m.workoutId}`;
                    return (
                      <DiffRow
                        key={key}
                        itemKey={key}
                        before={before ? summarizeWorkoutLine(before) : `workout ${m.workoutId}`}
                        after={before ? summarizeWorkoutLine({ ...before, ...m.patch }) : '—'}
                        explanation={m.explanation}
                        checked={Boolean(checked[key])}
                        onToggle={(value) => setChecked({ ...checked, [key]: value })}
                      />
                    );
                  })}
                  {proposal.remove.map((r: ProposedWorkoutRemoval) => {
                    const before = workoutById.get(r.workoutId);
                    const key: ReviewItemKey = `remove:${r.workoutId}`;
                    return (
                      <DiffRow
                        key={key}
                        itemKey={key}
                        before={before ? summarizeWorkoutLine(before) : `workout ${r.workoutId}`}
                        after="Removed"
                        explanation={r.explanation}
                        checked={Boolean(checked[key])}
                        onToggle={(value) => setChecked({ ...checked, [key]: value })}
                      />
                    );
                  })}
                  {proposal.add.map((a: ProposedWorkoutAddition, i: number) => {
                    const key: ReviewItemKey = `add:${i}`;
                    return (
                      <DiffRow
                        key={key}
                        itemKey={key}
                        before="—"
                        after={summarizeWorkoutLine(a)}
                        explanation={a.explanation}
                        checked={Boolean(checked[key])}
                        onToggle={(value) => setChecked({ ...checked, [key]: value })}
                      />
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          <div className="controls">
            {hasChanges && (
              <button disabled={!anyChecked || apply.isPending} onClick={() => apply.mutate()}>
                Apply selected changes
              </button>
            )}
            <button
              onClick={() => {
                setProposal(null);
                setOpen(false);
              }}
            >
              {hasChanges ? 'Discard' : 'Close'}
            </button>
            {apply.error && (
              <span className="status">Failed to apply: {(apply.error as Error).message}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
