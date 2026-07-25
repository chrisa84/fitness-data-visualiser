import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TrainingPlanWorkout, WorkoutType } from '@fitness/shared';
import { WORKOUT_TYPES } from '@fitness/shared';
import { useState } from 'react';
import { deleteTrainingPlanWorkout, updateTrainingPlanWorkout } from '../../api';
import {
  type WorkoutEditDraft,
  draftFromWorkout,
  draftToPatch,
  metresToKmInput,
  workoutDetailsLine,
} from './workoutFormat';

/**
 * One row of the active plan's checklist: tick to complete, or expand into a
 * full inline editor. The server validates the *merged* workout, so a partial
 * edit here can still be rejected — surface that error rather than swallowing it.
 */
export default function WorkoutRow({ workout }: { workout: TrainingPlanWorkout }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['training-plans'] });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<WorkoutEditDraft>(() => draftFromWorkout(workout));

  const tick = useMutation({
    mutationFn: (completedAt: string | null) =>
      updateTrainingPlanWorkout(workout.id, { completedAt }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => deleteTrainingPlanWorkout(workout.id),
    onSuccess: invalidate,
  });
  const save = useMutation({
    mutationFn: () => updateTrainingPlanWorkout(workout.id, draftToPatch(draft)),
    onSuccess: () => {
      invalidate();
      setEditing(false);
    },
  });

  const startEdit = () => {
    save.reset();
    setDraft(draftFromWorkout(workout));
    setEditing(true);
  };

  const field = (
    label: string,
    key: keyof WorkoutEditDraft,
    opts: { placeholder?: string; width?: number } = {},
  ) => (
    <label>
      {label}{' '}
      <input
        value={draft[key] as string}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        placeholder={opts.placeholder}
        style={{ width: opts.width ?? 70 }}
      />
    </label>
  );

  const textArea = (label: string, key: 'description' | 'notes') => (
    <div className="controls" style={{ display: 'block' }}>
      <label style={{ display: 'block', width: '100%' }}>
        {label}
        <br />
        <textarea
          value={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
          rows={2}
          style={{ width: '100%', maxWidth: 500, boxSizing: 'border-box' }}
        />
      </label>
    </div>
  );

  if (editing) {
    return (
      <tr>
        <td colSpan={6}>
          <div
            style={{
              border: '1px solid #3a4250',
              borderRadius: 6,
              padding: '0.75rem',
              margin: '0.4rem 0',
            }}
          >
            <div className="controls">
              <label>
                date{' '}
                <input
                  type="date"
                  value={draft.date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                />
              </label>
              <label>
                type{' '}
                <select
                  value={draft.workoutType}
                  onChange={(e) => setDraft({ ...draft, workoutType: e.target.value as WorkoutType })}
                >
                  {WORKOUT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              {field('distance (km)', 'targetDistanceKm')}
              {field('duration (h:mm:ss)', 'targetDurationStr', { placeholder: '0:30:00', width: 80 })}
            </div>
            <div className="controls" style={{ display: 'block' }}>
              <label style={{ display: 'block', width: '100%' }}>
                title
                <br />
                <input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  style={{ width: '100%', maxWidth: 400, boxSizing: 'border-box' }}
                />
              </label>
            </div>
            <div className="controls">
              {field('pace (mm:ss/km)', 'targetPaceStr', { placeholder: '5:00' })}
              {field('pace range min', 'targetPaceMinStr', { placeholder: '4:45' })}
              {field('max', 'targetPaceMaxStr', { placeholder: '5:15' })}
            </div>
            {textArea('description', 'description')}
            {textArea('notes', 'notes')}
            <div className="controls">
              <button disabled={save.isPending} onClick={() => save.mutate()}>
                Save
              </button>
              <button disabled={save.isPending} onClick={() => setEditing(false)}>
                Cancel
              </button>
              {save.error && <span className="status">{(save.error as Error).message}</span>}
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        <input
          type="checkbox"
          checked={workout.completedAt != null}
          onChange={(e) => tick.mutate(e.target.checked ? new Date().toISOString() : null)}
        />
      </td>
      <td>{workout.date}</td>
      <td>{workout.workoutType}</td>
      <td>
        {workout.title}
        {workoutDetailsLine(workout) && (
          <div className="status" style={{ fontSize: '0.85em' }}>
            {workoutDetailsLine(workout)}
          </div>
        )}
      </td>
      <td>{workout.targetDistanceM != null ? `${metresToKmInput(workout.targetDistanceM)} km` : '—'}</td>
      <td>
        <button onClick={startEdit}>edit</button>{' '}
        <button onClick={() => remove.mutate()} disabled={remove.isPending}>
          delete
        </button>
      </td>
    </tr>
  );
}
