import type {
  TrainingPlanAutofill,
  TrainingPlanWorkout,
  TrainingPlanWorkoutInput,
  WorkoutType,
} from '@fitness/shared';
import { formatDuration, formatKm, formatPaceFromSecPerKm } from '../../format';

/**
 * Date maths, parsing and one-line summaries shared across the Training page's
 * three workout tables (draft preview, active checklist, review diff). Kept
 * free of React so the formatting rules live in one place rather than being
 * re-derived per table.
 */

export const DAYS = [
  { code: 'mon', label: 'Mon' },
  { code: 'tue', label: 'Tue' },
  { code: 'wed', label: 'Wed' },
  { code: 'thu', label: 'Thu' },
  { code: 'fri', label: 'Fri' },
  { code: 'sat', label: 'Sat' },
  { code: 'sun', label: 'Sun' },
] as const;

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dayIndex = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dayIndex);
  return d.toISOString().slice(0, 10);
}

/**
 * A non-race plan's last day. `durationWeeks * 7 - 1`, because `startDate` is
 * itself the first of those days — a 1-week plan starting Monday ends the
 * following Sunday, not the Monday after. This mirrors `computeEndDate` on the
 * server; the two drifted apart once already, so keep them in step.
 */
export function planEndDate(startDate: string, durationWeeks: number): string {
  return addDays(startDate, durationWeeks * 7 - 1);
}

/** Accepts "H:MM:SS" or "MM:SS"; returns undefined if unparseable. */
export function parseDurationInput(str: string): number | undefined {
  const parts = str.trim().split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => Number.isNaN(p))) return undefined;
  const [a, b, c] = parts.length === 3 ? parts : [0, ...parts];
  return a! * 3600 + b! * 60 + c!;
}

export function summarizeNonRunningLoad(data: TrainingPlanAutofill): string | null {
  const active = data.nonRunningLoad.filter((g) => g.count > 0);
  if (active.length === 0) return null;
  return active
    .map(
      (g) =>
        `${g.group}: ${g.count} sessions, ${g.distanceKm} km (avg ${(g.distanceKm / g.count).toFixed(1)} km/session)`,
    )
    .join('; ');
}

interface PaceFields {
  targetPaceSecPerKm?: number | null;
  targetPaceMinSecPerKm?: number | null;
  targetPaceMaxSecPerKm?: number | null;
}

/** A pace range when one is set, otherwise the point estimate. */
export function paceDisplay(w: PaceFields): string {
  if (w.targetPaceMinSecPerKm != null || w.targetPaceMaxSecPerKm != null) {
    return formatPaceFromSecPerKm(w.targetPaceMinSecPerKm, w.targetPaceMaxSecPerKm);
  }
  return formatPaceFromSecPerKm(w.targetPaceSecPerKm);
}

export function workoutDetailsLine(
  w: PaceFields & {
    targetDurationS?: number | null;
    description?: string | null;
    notes?: string | null;
  },
): string {
  const pace = paceDisplay(w);
  return [
    pace !== '—' ? pace : null,
    w.targetDurationS ? formatDuration(w.targetDurationS) : null,
    w.description,
    w.notes ? `note: ${w.notes}` : null,
  ]
    .filter((v): v is string => Boolean(v))
    .join(' · ');
}

export function summarizeWorkoutLine(
  w: PaceFields & {
    date: string;
    workoutType: WorkoutType;
    title: string;
    targetDistanceM?: number | null;
    targetDurationS?: number | null;
    description?: string | null;
    notes?: string | null;
  },
): string {
  const distance = w.targetDistanceM != null ? formatKm(w.targetDistanceM, 1) : null;
  const details = workoutDetailsLine(w);
  return [`${w.date} ${w.workoutType} "${w.title}"`, distance, details]
    .filter((v): v is string => Boolean(v))
    .join(' · ');
}

/** Distance in km to one decimal, the unit every workout table edits in. */
export function metresToKmInput(metres: number | null | undefined): string {
  return metres != null ? String(Math.round(metres / 100) / 10) : '';
}

export interface WorkoutEditDraft {
  date: string;
  workoutType: WorkoutType;
  title: string;
  description: string;
  targetDistanceKm: string;
  targetDurationStr: string;
  targetPaceStr: string;
  targetPaceMinStr: string;
  targetPaceMaxStr: string;
  notes: string;
}

export function draftFromWorkout(w: TrainingPlanWorkout): WorkoutEditDraft {
  return {
    date: w.date,
    workoutType: w.workoutType,
    title: w.title,
    description: w.description ?? '',
    targetDistanceKm: metresToKmInput(w.targetDistanceM),
    targetDurationStr: w.targetDurationS != null ? formatDuration(w.targetDurationS) : '',
    targetPaceStr: w.targetPaceSecPerKm != null ? formatDuration(w.targetPaceSecPerKm) : '',
    targetPaceMinStr: w.targetPaceMinSecPerKm != null ? formatDuration(w.targetPaceMinSecPerKm) : '',
    targetPaceMaxStr: w.targetPaceMaxSecPerKm != null ? formatDuration(w.targetPaceMaxSecPerKm) : '',
    notes: w.notes ?? '',
  };
}

export function draftToPatch(d: WorkoutEditDraft): Partial<TrainingPlanWorkoutInput> {
  return {
    date: d.date,
    workoutType: d.workoutType,
    title: d.title,
    description: d.description || undefined,
    targetDistanceM: d.targetDistanceKm ? Number(d.targetDistanceKm) * 1000 : undefined,
    targetDurationS: parseDurationInput(d.targetDurationStr),
    targetPaceSecPerKm: parseDurationInput(d.targetPaceStr),
    targetPaceMinSecPerKm: parseDurationInput(d.targetPaceMinStr),
    targetPaceMaxSecPerKm: parseDurationInput(d.targetPaceMaxStr),
    notes: d.notes || undefined,
  };
}
