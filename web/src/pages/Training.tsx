import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type {
  GeneratedTrainingPlan,
  TrainingPlanAutofill,
  TrainingPlanAutofillOverrides,
  TrainingPlanDetail,
  TrainingPlanWorkout,
  TrainingPlanWorkoutInput,
} from '@fitness/shared';
import { WORKOUT_TYPES } from '@fitness/shared';
import { useEffect, useState } from 'react';
import {
  createTrainingPlan,
  deleteTrainingPlanWorkout,
  endTrainingPlan,
  fetchEvents,
  fetchTrainingPlanAutofill,
  generateTrainingPlan,
  updateTrainingPlanWorkout,
} from '../api';
import { formatDuration, formatKm, formatPaceFromSecPerKm } from '../format';
import { useActiveTrainingPlan, useTrainingPlanDetail, useTrainingPlans } from '../trainingPlans';

const DAYS = [
  { code: 'mon', label: 'Mon' },
  { code: 'tue', label: 'Tue' },
  { code: 'wed', label: 'Wed' },
  { code: 'thu', label: 'Thu' },
  { code: 'fri', label: 'Fri' },
  { code: 'sat', label: 'Sat' },
  { code: 'sun', label: 'Sun' },
] as const;

const BLANK_FORM = {
  goalDescription: '',
  isRace: false,
  raceDistanceKm: '',
  raceDate: '',
  targetTime: '',
  startDate: '',
  durationWeeks: 8,
  daysPerWeek: 4,
  preferredDays: [] as string[],
  preferredLongRunDay: '',
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

/** Accepts "H:MM:SS" or "MM:SS"; returns undefined if unparseable. */
function parseDurationInput(str: string): number | undefined {
  const parts = str.trim().split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => Number.isNaN(p))) return undefined;
  const [a, b, c] = parts.length === 3 ? parts : [0, ...parts];
  return a! * 3600 + b! * 60 + c!;
}

function summarizeNonRunningLoad(data: TrainingPlanAutofill): string | null {
  const active = data.nonRunningLoad.filter((g) => g.count > 0);
  if (active.length === 0) return null;
  return active.map((g) => `${g.group}: ${g.count} sessions, ${g.distanceKm} km`).join('; ');
}

function paceDisplay(w: {
  targetPaceSecPerKm?: number | null;
  targetPaceMinSecPerKm?: number | null;
  targetPaceMaxSecPerKm?: number | null;
}): string {
  if (w.targetPaceMinSecPerKm != null || w.targetPaceMaxSecPerKm != null) {
    return formatPaceFromSecPerKm(w.targetPaceMinSecPerKm, w.targetPaceMaxSecPerKm);
  }
  return formatPaceFromSecPerKm(w.targetPaceSecPerKm);
}

function workoutDetailsLine(w: {
  targetPaceSecPerKm?: number | null;
  targetPaceMinSecPerKm?: number | null;
  targetPaceMaxSecPerKm?: number | null;
  targetDurationS?: number | null;
  description?: string | null;
}): string {
  const pace = paceDisplay(w);
  const parts = [pace !== '—' ? pace : null, w.targetDurationS ? formatDuration(w.targetDurationS) : null, w.description]
    .filter((v): v is string => Boolean(v));
  return parts.join(' · ');
}

/** Fitness context card — always visible and editable, auto-populated from Garmin data. */
function FitnessContextCard({
  autofill,
  overrides,
  setOverrides,
  onRefresh,
  isRefreshing,
}: {
  autofill: TrainingPlanAutofill | undefined;
  overrides: TrainingPlanAutofillOverrides;
  setOverrides: (o: TrainingPlanAutofillOverrides) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  return (
    <div className="settings-card">
      <h3>Your recent fitness (editable)</h3>
      <div className="controls">
        <label>
          weekly volume (km, avg last 6 wks){' '}
          <input
            type="number"
            value={overrides.weeklyVolumeAvgKm ?? ''}
            onChange={(e) => setOverrides({ ...overrides, weeklyVolumeAvgKm: e.target.value === '' ? null : Number(e.target.value) })}
            style={{ width: 70 }}
          />
        </label>
        <label>
          longest recent run (km, last 12 wks){' '}
          <input
            type="number"
            value={overrides.longestRecentRunKm ?? ''}
            onChange={(e) => setOverrides({ ...overrides, longestRecentRunKm: e.target.value === '' ? null : Number(e.target.value) })}
            style={{ width: 70 }}
          />
        </label>
        <label>
          VO2max{' '}
          <input
            type="number"
            value={overrides.vo2max ?? ''}
            onChange={(e) => setOverrides({ ...overrides, vo2max: e.target.value === '' ? null : Number(e.target.value) })}
            style={{ width: 60 }}
          />
        </label>
        <button type="button" disabled={isRefreshing} onClick={onRefresh}>
          Refresh from Garmin
        </button>
      </div>

      {autofill && autofill.weeklyVolumeTrend.length > 0 && (
        <p className="status">
          Volume trend (oldest→newest): {autofill.weeklyVolumeTrend.map((w) => `${w.distanceKm}km`).join(', ')}
        </p>
      )}

      {autofill && autofill.representativeRuns.length > 0 && (
        <p className="status">
          Representative recent runs (last 3 months):{' '}
          {autofill.representativeRuns
            .map((r) => `${r.date} ${r.label.replace('_', ' ')}: ${formatKm(r.distanceKm * 1000, 1)} in ${formatDuration(r.durationS)}`)
            .join('; ')}
        </p>
      )}

      {autofill && (autofill.trainingLoad.acute != null || autofill.trainingLoad.chronic != null) && (
        <p className="status">
          Training load: acute {autofill.trainingLoad.acute ?? '—'}, chronic {autofill.trainingLoad.chronic ?? '—'}
          {autofill.trainingLoad.acwrTrend.length > 0 ? `, ACWR trend ${autofill.trainingLoad.acwrTrend.join(' → ')}` : ''}
        </p>
      )}

      <div className="controls">
        <label style={{ display: 'block', minWidth: 300 }}>
          Anything about your recent pace/effort we should know? (optional)
          <br />
          <textarea
            value={overrides.paceNotes ?? ''}
            onChange={(e) => setOverrides({ ...overrides, paceNotes: e.target.value })}
            rows={2}
            style={{ width: '100%', minWidth: 300 }}
          />
        </label>
      </div>
      <div className="controls">
        <label style={{ display: 'block', minWidth: 300 }}>
          Other current training (non-running) — edit if this looks wrong
          <br />
          <textarea
            value={overrides.nonRunningLoadSummary ?? (autofill ? summarizeNonRunningLoad(autofill) ?? '' : '')}
            onChange={(e) => setOverrides({ ...overrides, nonRunningLoadSummary: e.target.value })}
            rows={2}
            style={{ width: '100%', minWidth: 300 }}
          />
        </label>
      </div>
    </div>
  );
}

function IntakeForm() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(BLANK_FORM);
  const [overrides, setOverrides] = useState<TrainingPlanAutofillOverrides>({});
  const [draftPlan, setDraftPlan] = useState<GeneratedTrainingPlan | null>(null);

  const autofillQuery = useQuery({ queryKey: ['training-plan-autofill'], queryFn: fetchTrainingPlanAutofill });

  useEffect(() => {
    if (!autofillQuery.data) return;
    const data = autofillQuery.data;
    setOverrides({
      weeklyVolumeAvgKm: data.weeklyVolumeAvgKm,
      longestRecentRunKm: data.longestRecentRunKm,
      vo2max: data.vo2max,
      nonRunningLoadSummary: summarizeNonRunningLoad(data),
      paceNotes: null,
    });
  }, [autofillQuery.data]);

  const maxRaceDate = form.startDate ? addDays(form.startDate, 84) : undefined;
  const endDate = form.isRace
    ? form.raceDate || undefined
    : form.startDate
      ? addDays(form.startDate, form.durationWeeks * 7)
      : undefined;

  const events = useQuery({
    queryKey: ['events', form.startDate, endDate],
    queryFn: () => fetchEvents({ from: form.startDate, to: endDate }),
    enabled: Boolean(form.startDate && endDate),
  });

  const generate = useMutation({
    mutationFn: () =>
      generateTrainingPlan({
        goalDescription: form.goalDescription || undefined,
        isRace: form.isRace,
        goalRaceDistanceM: form.isRace && form.raceDistanceKm ? Number(form.raceDistanceKm) * 1000 : undefined,
        goalTargetDurationS: form.isRace ? parseDurationInput(form.targetTime) : undefined,
        raceDate: form.isRace ? form.raceDate : undefined,
        startDate: form.startDate,
        durationWeeks: form.isRace ? undefined : form.durationWeeks,
        daysPerWeek: form.daysPerWeek,
        preferredDays: form.preferredDays.length > 0 ? form.preferredDays : undefined,
        preferredLongRunDay: form.preferredLongRunDay || undefined,
        autofill: overrides,
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

  const toggleDay = (code: string) => {
    setForm((f) => ({
      ...f,
      preferredDays: f.preferredDays.includes(code) ? f.preferredDays.filter((d) => d !== code) : [...f.preferredDays, code],
    }));
  };

  const canGenerate = Boolean(
    form.startDate && (form.isRace ? form.raceDate && form.raceDistanceKm : form.durationWeeks),
  );

  return (
    <>
      <p className="status">
        No active plan. Fill this in, then generate a plan to preview before saving.
      </p>

      <div className="controls">
        <label>
          <input type="checkbox" checked={form.isRace} onChange={(e) => setForm({ ...form, isRace: e.target.checked })} />{' '}
          This is for a specific race
        </label>
      </div>

      <div className="controls">
        <label>
          start date{' '}
          <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </label>
        {form.isRace ? (
          <>
            <label>
              race distance (km){' '}
              <input
                type="number"
                value={form.raceDistanceKm}
                onChange={(e) => setForm({ ...form, raceDistanceKm: e.target.value })}
                style={{ width: 70 }}
              />
            </label>
            <label>
              race date{' '}
              <input
                type="date"
                value={form.raceDate}
                min={form.startDate || undefined}
                max={maxRaceDate}
                onChange={(e) => setForm({ ...form, raceDate: e.target.value })}
              />
            </label>
            <label>
              target time (optional, h:mm:ss){' '}
              <input
                value={form.targetTime}
                onChange={(e) => setForm({ ...form, targetTime: e.target.value })}
                placeholder="1:50:00"
                style={{ width: 90 }}
              />
            </label>
          </>
        ) : (
          <label>
            plan length (weeks){' '}
            <input
              type="number"
              min={1}
              max={12}
              value={form.durationWeeks}
              onChange={(e) => setForm({ ...form, durationWeeks: Number(e.target.value) })}
              style={{ width: 60 }}
            />
          </label>
        )}
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
        <span>preferred training days (optional):</span>
        {DAYS.map((d) => (
          <label key={d.code}>
            <input type="checkbox" checked={form.preferredDays.includes(d.code)} onChange={() => toggleDay(d.code)} /> {d.label}
          </label>
        ))}
        {form.preferredDays.length > 0 && (
          <label>
            long run on{' '}
            <select value={form.preferredLongRunDay} onChange={(e) => setForm({ ...form, preferredLongRunDay: e.target.value })}>
              <option value="">no preference</option>
              {form.preferredDays.map((code) => (
                <option key={code} value={code}>
                  {DAYS.find((d) => d.code === code)!.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="controls">
        <label>
          Anything about your goal worth knowing? (optional)
          <br />
          <textarea
            placeholder='e.g. "want to finally break 25 minutes for 5k"'
            value={form.goalDescription}
            onChange={(e) => setForm({ ...form, goalDescription: e.target.value })}
            rows={2}
            style={{ minWidth: 280 }}
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
      {events.data && events.data.length === 0 && form.startDate && endDate && (
        <p className="status">
          No events logged for this window. <Link to="/events">Add one</Link> if relevant (holidays, injury, etc).
        </p>
      )}

      <FitnessContextCard
        autofill={autofillQuery.data}
        overrides={overrides}
        setOverrides={setOverrides}
        onRefresh={() => autofillQuery.refetch()}
        isRefreshing={autofillQuery.isFetching}
      />

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
                <th>Workout</th>
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
                    {workoutDetailsLine(w) && <div className="status" style={{ fontSize: '0.85em' }}>{workoutDetailsLine(w)}</div>}
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
      <td>
        {workout.title}
        {workoutDetailsLine(workout) && <div className="status" style={{ fontSize: '0.85em' }}>{workoutDetailsLine(workout)}</div>}
      </td>
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
              <th>Workout</th>
              <th>Distance</th>
            </tr>
          </thead>
          <tbody>
            {detail.data.workouts.map((w) => (
              <tr key={w.id}>
                <td>{w.completedAt != null ? '✓' : ''}</td>
                <td>{w.date}</td>
                <td>{w.workoutType}</td>
                <td>
                  {w.title}
                  {workoutDetailsLine(w) && <div className="status" style={{ fontSize: '0.85em' }}>{workoutDetailsLine(w)}</div>}
                </td>
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
