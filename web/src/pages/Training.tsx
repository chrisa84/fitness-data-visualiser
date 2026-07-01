import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type {
  GeneratedTrainingPlan,
  TrainingPlanAutofillOverrides,
  TrainingPlanDetail,
  TrainingPlanWorkout,
  TrainingPlanWorkoutInput,
} from '@fitness/shared';
import { WORKOUT_TYPES } from '@fitness/shared';
import { useState } from 'react';
import {
  createTrainingPlan,
  deleteTrainingPlanWorkout,
  endTrainingPlan,
  fetchEvents,
  fetchTrainingPlanAutofill,
  generateTrainingPlan,
  updateTrainingPlanWorkout,
} from '../api';
import { formatDuration, formatKm } from '../format';
import { useActiveTrainingPlan, useTrainingPlanDetail, useTrainingPlans } from '../trainingPlans';

const BLANK_FORM = {
  goalDescription: '',
  startDate: '',
  endDate: '',
  daysPerWeek: 4,
  otherTraining: '',
  upcomingNotes: '',
};

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dayIndex = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dayIndex);
  return d.toISOString().slice(0, 10);
}

function summarizeNonRunningLoad(data: Awaited<ReturnType<typeof fetchTrainingPlanAutofill>>): string | null {
  const active = data.nonRunningLoad.filter((g) => g.count > 0);
  if (active.length === 0) return null;
  return active.map((g) => `${g.group}: ${g.count} sessions, ${g.distanceKm} km`).join('; ');
}

function formatRecordValue(value: number, format: string | undefined, unit: string): string {
  if (format === 'duration') return formatDuration(value);
  if (format === 'distance_km') return formatKm(value, 1);
  return `${Math.round(value)}${unit ? ` ${unit}` : ''}`;
}

function relevantPaceFromRecords(data: Awaited<ReturnType<typeof fetchTrainingPlanAutofill>>): string | null {
  if (data.records.length === 0) return null;
  return data.records
    .map((r) => `${r.label}: ${formatRecordValue(r.value, r.format, r.unit)}`)
    .join('; ');
}

function IntakeForm() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(BLANK_FORM);
  const [autofill, setAutofill] = useState<TrainingPlanAutofillOverrides>({});
  const [draftPlan, setDraftPlan] = useState<GeneratedTrainingPlan | null>(null);

  const maxEndDate = form.startDate ? addDays(form.startDate, 84) : undefined;

  const events = useQuery({
    queryKey: ['events', form.startDate, form.endDate],
    queryFn: () => fetchEvents({ from: form.startDate, to: form.endDate }),
    enabled: Boolean(form.startDate && form.endDate),
  });

  const autofillMutation = useMutation({
    mutationFn: fetchTrainingPlanAutofill,
    onSuccess: (data) => {
      setAutofill({
        weeklyVolumeKm: data.weeklyVolume.at(-1)?.distanceKm ?? null,
        longestRecentRunKm: data.longestRecentRunKm,
        relevantPace: relevantPaceFromRecords(data),
        vo2max: data.vo2max,
        trainingLoadSummary: `acute ${data.trainingLoad.acute ?? '—'}, chronic ${data.trainingLoad.chronic ?? '—'}, ACWR ${data.trainingLoad.acwr ?? '—'}`,
        readinessScore: data.readinessScore,
        nonRunningLoadSummary: summarizeNonRunningLoad(data),
      });
    },
  });

  const generate = useMutation({
    mutationFn: () =>
      generateTrainingPlan({
        goalDescription: form.goalDescription,
        startDate: form.startDate,
        endDate: form.endDate,
        daysPerWeek: form.daysPerWeek,
        autofill,
        otherTraining: form.otherTraining || undefined,
        upcomingNotes: form.upcomingNotes || undefined,
      }),
    onSuccess: setDraftPlan,
  });

  const save = useMutation({
    mutationFn: () => {
      const plan = draftPlan!;
      return createTrainingPlan({
        goalDescription: plan.goalDescription,
        startDate: plan.startDate,
        endDate: plan.endDate,
        daysPerWeek: plan.daysPerWeek,
        isRace: plan.isRace,
        goalRaceDistanceM: plan.goalRaceDistanceM,
        goalTargetDurationS: plan.goalTargetDurationS,
        workouts: plan.workouts,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['training-plans'] });
      setDraftPlan(null);
      setForm(BLANK_FORM);
      setAutofill({});
    },
  });

  const updateWorkoutDraft = (index: number, patch: Partial<TrainingPlanWorkoutInput>) => {
    if (!draftPlan) return;
    const workouts = draftPlan.workouts.map((w, i) => (i === index ? { ...w, ...patch } : w));
    setDraftPlan({ ...draftPlan, workouts });
  };

  const removeWorkoutDraft = (index: number) => {
    if (!draftPlan) return;
    setDraftPlan({ ...draftPlan, workouts: draftPlan.workouts.filter((_, i) => i !== index) });
  };

  const canGenerate = Boolean(form.goalDescription && form.startDate && form.endDate);

  return (
    <>
      <p className="status">
        No active plan. Fill this in, optionally autofill from your data, then generate a plan to preview
        before saving.
      </p>

      <div className="controls">
        <label>
          Goal
          <br />
          <textarea
            placeholder='e.g. "half marathon in 1:50"'
            value={form.goalDescription}
            onChange={(e) => setForm({ ...form, goalDescription: e.target.value })}
            rows={2}
            style={{ minWidth: 280 }}
          />
        </label>
        <label>
          from <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </label>
        <label>
          to{' '}
          <input
            type="date"
            value={form.endDate}
            max={maxEndDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })}
          />
        </label>
        <label>
          days/week{' '}
          <input
            type="number"
            min={1}
            max={7}
            value={form.daysPerWeek}
            onChange={(e) => setForm({ ...form, daysPerWeek: Number(e.target.value) })}
            style={{ width: 50 }}
          />
        </label>
      </div>
      <div className="controls">
        <label>
          Anything else you're currently training that's not logged here? (optional)
          <br />
          <textarea
            value={form.otherTraining}
            onChange={(e) => setForm({ ...form, otherTraining: e.target.value })}
            rows={2}
            style={{ minWidth: 320 }}
          />
        </label>
        <label>
          Anything coming up in this window we should know about? (optional)
          <br />
          <textarea
            value={form.upcomingNotes}
            onChange={(e) => setForm({ ...form, upcomingNotes: e.target.value })}
            rows={2}
            style={{ minWidth: 320 }}
          />
        </label>
      </div>

      {events.data && events.data.length > 0 && (
        <p className="status">
          Logged events in this window: {events.data.map((e) => `${e.type} "${e.label}" (${e.date})`).join('; ')} —{' '}
          <Link to="/events">manage events</Link>
        </p>
      )}
      {events.data && events.data.length === 0 && form.startDate && form.endDate && (
        <p className="status">
          No events logged for this window. <Link to="/events">Add one</Link> if relevant (holidays, injury, etc).
        </p>
      )}

      <div className="controls">
        <button disabled={autofillMutation.isPending} onClick={() => autofillMutation.mutate()}>
          Autofill from my data
        </button>
      </div>

      {autofillMutation.isSuccess && (
        <div className="settings-card">
          <h3>Autofilled fitness summary (editable)</h3>
          <div className="controls">
            <label>
              weekly volume (km){' '}
              <input
                type="number"
                value={autofill.weeklyVolumeKm ?? ''}
                onChange={(e) => setAutofill({ ...autofill, weeklyVolumeKm: e.target.value === '' ? null : Number(e.target.value) })}
                style={{ width: 70 }}
              />
            </label>
            <label>
              longest recent run (km){' '}
              <input
                type="number"
                value={autofill.longestRecentRunKm ?? ''}
                onChange={(e) => setAutofill({ ...autofill, longestRecentRunKm: e.target.value === '' ? null : Number(e.target.value) })}
                style={{ width: 70 }}
              />
            </label>
            <label>
              VO2max{' '}
              <input
                type="number"
                value={autofill.vo2max ?? ''}
                onChange={(e) => setAutofill({ ...autofill, vo2max: e.target.value === '' ? null : Number(e.target.value) })}
                style={{ width: 60 }}
              />
            </label>
          </div>
          <div className="controls">
            <label style={{ display: 'block', minWidth: 300 }}>
              Relevant pace/PR
              <br />
              <textarea
                value={autofill.relevantPace ?? ''}
                onChange={(e) => setAutofill({ ...autofill, relevantPace: e.target.value })}
                rows={2}
                style={{ width: '100%', minWidth: 300 }}
              />
            </label>
          </div>
          <div className="controls">
            <label style={{ display: 'block', minWidth: 300 }}>
              Training load summary
              <br />
              <textarea
                value={autofill.trainingLoadSummary ?? ''}
                onChange={(e) => setAutofill({ ...autofill, trainingLoadSummary: e.target.value })}
                rows={2}
                style={{ width: '100%', minWidth: 300 }}
              />
            </label>
          </div>
          <div className="controls">
            <label style={{ display: 'block', minWidth: 300 }}>
              Other current training (non-running)
              <br />
              <textarea
                value={autofill.nonRunningLoadSummary ?? ''}
                onChange={(e) => setAutofill({ ...autofill, nonRunningLoadSummary: e.target.value })}
                rows={2}
                style={{ width: '100%', minWidth: 300 }}
              />
            </label>
          </div>
        </div>
      )}

      <div className="controls">
        <button disabled={!canGenerate || generate.isPending} onClick={() => generate.mutate()}>
          {draftPlan ? 'Regenerate' : 'Generate'}
        </button>
        {generate.error && <span className="status">Failed to generate: {(generate.error as Error).message}</span>}
      </div>

      {draftPlan && (
        <>
          {draftPlan.rationale && (
            <div className="settings-card">
              <h3>Why this plan</h3>
              <p className="status">{draftPlan.rationale}</p>
            </div>
          )}
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Title</th>
                <th>Distance (km)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {draftPlan.workouts.map((w, i) => (
                <tr key={i}>
                  <td>
                    <input type="date" value={w.date} onChange={(e) => updateWorkoutDraft(i, { date: e.target.value })} />
                  </td>
                  <td>
                    <select value={w.workoutType} onChange={(e) => updateWorkoutDraft(i, { workoutType: e.target.value as TrainingPlanWorkoutInput['workoutType'] })}>
                      {WORKOUT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input value={w.title} onChange={(e) => updateWorkoutDraft(i, { title: e.target.value })} style={{ minWidth: 180 }} />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={w.targetDistanceM != null ? Math.round(w.targetDistanceM / 100) / 10 : ''}
                      onChange={(e) =>
                        updateWorkoutDraft(i, {
                          targetDistanceM: e.target.value === '' ? undefined : Number(e.target.value) * 1000,
                        })
                      }
                      style={{ width: 70 }}
                    />
                  </td>
                  <td>
                    <button onClick={() => removeWorkoutDraft(i)}>delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="controls">
            <button disabled={save.isPending} onClick={() => save.mutate()}>
              Save plan
            </button>
            {save.error && <span className="status">{(save.error as Error).message}</span>}
          </div>
        </>
      )}
    </>
  );
}

function WorkoutRow({ workout }: { workout: TrainingPlanWorkout }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['training-plans'] });

  const tick = useMutation({
    mutationFn: (completedAt: string | null) => updateTrainingPlanWorkout(workout.id, { completedAt }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => deleteTrainingPlanWorkout(workout.id),
    onSuccess: invalidate,
  });

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
      <td>{workout.title}</td>
      <td>{workout.targetDistanceM != null ? `${Math.round(workout.targetDistanceM / 100) / 10} km` : '—'}</td>
      <td>
        <button onClick={() => remove.mutate()} disabled={remove.isPending}>
          delete
        </button>
      </td>
    </tr>
  );
}

function ActivePlanView({ detail }: { detail: TrainingPlanDetail }) {
  const queryClient = useQueryClient();
  const end = useMutation({
    mutationFn: () => endTrainingPlan(detail.plan.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['training-plans'] }),
  });

  const weeks = new Map<string, TrainingPlanWorkout[]>();
  for (const w of detail.workouts) {
    const key = mondayOf(w.date);
    weeks.set(key, [...(weeks.get(key) ?? []), w]);
  }

  return (
    <>
      <p className="status">
        {detail.plan.goalDescription} — {detail.plan.startDate} to {detail.plan.endDate}, {detail.plan.daysPerWeek}{' '}
        days/week.
      </p>
      <div className="controls">
        <button disabled={end.isPending} onClick={() => end.mutate()}>
          End plan
        </button>
      </div>
      {[...weeks.entries()].map(([weekStart, workouts]) => (
        <div key={weekStart}>
          <h3>Week of {weekStart}</h3>
          <table>
            <thead>
              <tr>
                <th>Done</th>
                <th>Date</th>
                <th>Type</th>
                <th>Title</th>
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

function HistorySection() {
  const ended = useTrainingPlans('ended');
  const [expandedId, setExpandedId] = useState<number | undefined>(undefined);
  const detail = useTrainingPlanDetail(expandedId);

  if (!ended.data || ended.data.length === 0) return null;

  return (
    <>
      <h3>Past plans</h3>
      <table>
        <thead>
          <tr>
            <th>Goal</th>
            <th>Dates</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {ended.data.map((plan) => (
            <tr key={plan.id}>
              <td>{plan.goalDescription}</td>
              <td>
                {plan.startDate} to {plan.endDate}
              </td>
              <td>
                <button onClick={() => setExpandedId(expandedId === plan.id ? undefined : plan.id)}>
                  {expandedId === plan.id ? 'hide' : 'view'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {detail.data && (
        <table>
          <thead>
            <tr>
              <th>Done</th>
              <th>Date</th>
              <th>Type</th>
              <th>Title</th>
              <th>Distance</th>
            </tr>
          </thead>
          <tbody>
            {detail.data.workouts.map((w) => (
              <tr key={w.id}>
                <td>{w.completedAt != null ? '✓' : ''}</td>
                <td>{w.date}</td>
                <td>{w.workoutType}</td>
                <td>{w.title}</td>
                <td>{w.targetDistanceM != null ? `${Math.round(w.targetDistanceM / 100) / 10} km` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export default function Training() {
  const activePlan = useActiveTrainingPlan();

  return (
    <>
      {activePlan.isLoading && <p className="status">Loading…</p>}
      {!activePlan.isLoading && activePlan.data && <ActivePlanView detail={activePlan.data} />}
      {!activePlan.isLoading && !activePlan.data && <IntakeForm />}
      <HistorySection />
    </>
  );
}
