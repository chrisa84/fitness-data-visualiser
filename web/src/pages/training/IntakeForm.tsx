import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { GeneratedTrainingPlan, TrainingPlanAutofillOverrides, TrainingPlanWorkoutInput } from '@fitness/shared';
import { WORKOUT_TYPES } from '@fitness/shared';
import { useEffect, useRef, useState } from 'react';
import {
  createTrainingPlan,
  fetchEvents,
  fetchTrainingPlanAutofill,
  generateTrainingPlan,
  reviseTrainingPlan,
} from '../../api';
import FitnessContextCard from './FitnessContextCard';
import {
  DAYS,
  addDays,
  metresToKmInput,
  parseDurationInput,
  planEndDate,
  summarizeNonRunningLoad,
  workoutDetailsLine,
} from './workoutFormat';

/** The plan window is capped server-side at 12 weeks (MAX_HORIZON_DAYS). */
const MAX_PLAN_DAYS = 84;

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

/** Goal/date intake, AI generation, and the editable draft preview before saving. */
export default function IntakeForm() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(BLANK_FORM);
  const [overrides, setOverrides] = useState<TrainingPlanAutofillOverrides>({});
  const [draftPlan, setDraftPlan] = useState<GeneratedTrainingPlan | null>(null);
  const [previousDraftPlan, setPreviousDraftPlan] = useState<GeneratedTrainingPlan | null>(null);
  const [revisionInstructions, setRevisionInstructions] = useState('');

  const autofillQuery = useQuery({
    queryKey: ['training-plan-autofill'],
    queryFn: fetchTrainingPlanAutofill,
  });

  // Populate the editable overrides once, from the first successful fetch — never again.
  // TanStack Query's defaults (refetchOnWindowFocus/refetchOnReconnect) mean autofillQuery.data
  // can silently change later (e.g. backgrounding/foregrounding the PWA), and re-syncing then
  // would clobber whatever the user has already typed. "Refresh from Garmin" still updates the
  // read-only trend/representative-run display below, just not these editable fields.
  const hasSyncedOverrides = useRef(false);
  useEffect(() => {
    if (!autofillQuery.data || hasSyncedOverrides.current) return;
    hasSyncedOverrides.current = true;
    const data = autofillQuery.data;
    setOverrides({
      weeklyVolumeAvgKm: data.weeklyVolumeAvgKm,
      longestRecentRunKm: data.longestRecentRunKm,
      vo2max: data.vo2max,
      nonRunningLoadSummary: summarizeNonRunningLoad(data),
      paceNotes: null,
    });
  }, [autofillQuery.data]);

  const maxRaceDate = form.startDate ? addDays(form.startDate, MAX_PLAN_DAYS) : undefined;
  const endDate = form.isRace
    ? form.raceDate || undefined
    : form.startDate
      ? planEndDate(form.startDate, form.durationWeeks)
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
        goalRaceDistanceM:
          form.isRace && form.raceDistanceKm ? Number(form.raceDistanceKm) * 1000 : undefined,
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
    onSuccess: (plan) => {
      setDraftPlan(plan);
      setPreviousDraftPlan(null);
    },
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
      setPreviousDraftPlan(null);
      setForm(BLANK_FORM);
    },
  });

  const revise = useMutation({
    mutationFn: () => {
      const plan = draftPlan!;
      return reviseTrainingPlan({
        goalDescription: plan.goalDescription || undefined,
        isRace: plan.isRace,
        goalRaceDistanceM: plan.goalRaceDistanceM,
        goalTargetDurationS: plan.goalTargetDurationS,
        startDate: plan.startDate,
        endDate: plan.endDate,
        daysPerWeek: plan.daysPerWeek,
        preferredDays: form.preferredDays.length > 0 ? form.preferredDays : undefined,
        preferredLongRunDay: form.preferredLongRunDay || undefined,
        otherTraining: form.otherTraining || undefined,
        upcomingNotes: form.upcomingNotes || undefined,
        currentWorkouts: plan.workouts,
        currentRationale: plan.rationale,
        instructions: revisionInstructions,
      });
    },
    onSuccess: (revised) => {
      setPreviousDraftPlan(draftPlan);
      setDraftPlan(revised);
      setRevisionInstructions('');
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
      preferredDays: f.preferredDays.includes(code)
        ? f.preferredDays.filter((d) => d !== code)
        : [...f.preferredDays, code],
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
          <input
            type="checkbox"
            checked={form.isRace}
            onChange={(e) => setForm({ ...form, isRace: e.target.checked })}
          />{' '}
          This is for a specific race
        </label>
      </div>

      <div className="controls">
        <label>
          start date{' '}
          <input
            type="date"
            value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
          />
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
            <input
              type="checkbox"
              checked={form.preferredDays.includes(d.code)}
              onChange={() => toggleDay(d.code)}
            />{' '}
            {d.label}
          </label>
        ))}
        {form.preferredDays.length > 0 && (
          <label>
            long run on{' '}
            <select
              value={form.preferredLongRunDay}
              onChange={(e) => setForm({ ...form, preferredLongRunDay: e.target.value })}
            >
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

      <div className="controls" style={{ display: 'block' }}>
        <label style={{ display: 'block', width: '100%' }}>
          Anything about your goal worth knowing? (optional)
          <br />
          <textarea
            placeholder='e.g. "want to finally break 25 minutes for 5k"'
            value={form.goalDescription}
            onChange={(e) => setForm({ ...form, goalDescription: e.target.value })}
            rows={2}
            style={{ width: '100%', maxWidth: 500, boxSizing: 'border-box' }}
          />
        </label>
      </div>
      <div className="controls" style={{ display: 'block' }}>
        <label style={{ display: 'block', width: '100%' }}>
          Anything else you're currently training that's not logged here? (optional)
          <br />
          <textarea
            value={form.otherTraining}
            onChange={(e) => setForm({ ...form, otherTraining: e.target.value })}
            rows={2}
            style={{ width: '100%', maxWidth: 500, boxSizing: 'border-box' }}
          />
        </label>
        <label style={{ display: 'block', width: '100%' }}>
          Anything coming up
          {form.startDate && endDate ? ` between ${form.startDate} and ${endDate}` : ' in the plan window'}{' '}
          we should know about? (optional)
          <br />
          <textarea
            value={form.upcomingNotes}
            onChange={(e) => setForm({ ...form, upcomingNotes: e.target.value })}
            rows={2}
            style={{ width: '100%', maxWidth: 500, boxSizing: 'border-box' }}
          />
        </label>
      </div>

      {events.data && events.data.length > 0 && (
        <p className="status">
          Logged events in this window:{' '}
          {events.data.map((e) => `${e.type} "${e.label}" (${e.date})`).join('; ')} —{' '}
          <Link to="/events">manage events</Link>
        </p>
      )}
      {events.data && events.data.length === 0 && form.startDate && endDate && (
        <p className="status">
          No events logged for this window. <Link to="/events">Add one</Link> if relevant (holidays,
          injury, etc).
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
        {generate.error && (
          <span className="status">Failed to generate: {(generate.error as Error).message}</span>
        )}
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
                    <input
                      type="date"
                      value={w.date}
                      onChange={(e) => updateWorkoutDraft(i, { date: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      value={w.workoutType}
                      onChange={(e) =>
                        updateWorkoutDraft(i, {
                          workoutType: e.target.value as TrainingPlanWorkoutInput['workoutType'],
                        })
                      }
                    >
                      {WORKOUT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      value={w.title}
                      onChange={(e) => updateWorkoutDraft(i, { title: e.target.value })}
                      style={{ minWidth: 180 }}
                    />
                    {workoutDetailsLine(w) && (
                      <div className="status" style={{ fontSize: '0.85em' }}>
                        {workoutDetailsLine(w)}
                      </div>
                    )}
                  </td>
                  <td>
                    <input
                      type="number"
                      value={metresToKmInput(w.targetDistanceM)}
                      onChange={(e) =>
                        updateWorkoutDraft(i, {
                          targetDistanceM:
                            e.target.value === '' ? undefined : Number(e.target.value) * 1000,
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

          <div className="controls" style={{ display: 'block' }}>
            <label style={{ display: 'block', width: '100%' }}>
              Revise this plan — describe a targeted change (e.g. "make the long run shorter in week
              1", "swap Tuesday's tempo for an easy run")
              <br />
              <textarea
                value={revisionInstructions}
                onChange={(e) => setRevisionInstructions(e.target.value)}
                rows={2}
                style={{ width: '100%', maxWidth: 500, boxSizing: 'border-box' }}
              />
            </label>
          </div>
          <div className="controls">
            <button
              disabled={!revisionInstructions.trim() || revise.isPending}
              onClick={() => revise.mutate()}
            >
              Revise
            </button>
            {previousDraftPlan && (
              <button
                onClick={() => {
                  setDraftPlan(previousDraftPlan);
                  setPreviousDraftPlan(null);
                }}
              >
                Undo revision
              </button>
            )}
            {revise.error && (
              <span className="status">Failed to revise: {(revise.error as Error).message}</span>
            )}
          </div>

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
