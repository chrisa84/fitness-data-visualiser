import { z } from 'zod';
import { WORKOUT_TYPES } from '@fitness/shared';
import { isoDate } from '../routes/validation.js';

/** 12 weeks — matches realistic usage and keeps AI generation calls small. */
export const MAX_HORIZON_DAYS = 84;

const DAY_CODES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const dayCodeSchema = z.enum(DAY_CODES);

export const workoutTypeSchema = z.enum(WORKOUT_TYPES);

function withinHorizon(p: { startDate: string; endDate: string }): boolean {
  const days = (Date.parse(p.endDate) - Date.parse(p.startDate)) / 86_400_000;
  return days >= 0 && days <= MAX_HORIZON_DAYS;
}

function workoutsWithinWindow(p: { startDate: string; endDate: string; workouts?: { date: string }[] }): boolean {
  if (!p.workouts) return true;
  return p.workouts.every((w) => w.date >= p.startDate && w.date <= p.endDate);
}

/** Tempo/interval sessions need real structure (reps/pace/recovery), not just a distance. */
function hasMeaningfulDescriptionForHardEfforts(w: { workoutType: string; description?: string | null }): boolean {
  if (w.workoutType !== 'tempo' && w.workoutType !== 'interval') return true;
  return (w.description ?? '').trim().length >= 10;
}

function paceRangeOrdered(w: { targetPaceMinSecPerKm?: number | null; targetPaceMaxSecPerKm?: number | null }): boolean {
  if (w.targetPaceMinSecPerKm == null || w.targetPaceMaxSecPerKm == null) return true;
  return w.targetPaceMinSecPerKm <= w.targetPaceMaxSecPerKm;
}

const trainingPlanWorkoutObject = z.object({
  date: isoDate,
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  workoutType: workoutTypeSchema,
  targetDistanceM: z.number().nonnegative().nullish(),
  targetDurationS: z.number().nonnegative().nullish(),
  targetPaceSecPerKm: z.number().nonnegative().nullish(),
  targetPaceMinSecPerKm: z.number().nonnegative().nullish(),
  targetPaceMaxSecPerKm: z.number().nonnegative().nullish(),
  notes: z.string().max(2000).nullish(),
});

export const trainingPlanWorkoutBody = trainingPlanWorkoutObject
  .refine(hasMeaningfulDescriptionForHardEfforts, {
    message: 'tempo/interval workouts need a meaningful description (e.g. reps, pace, recovery)',
    path: ['description'],
  })
  .refine(paceRangeOrdered, {
    message: 'targetPaceMinSecPerKm must not be greater than targetPaceMaxSecPerKm',
    path: ['targetPaceMinSecPerKm'],
  });

export const trainingPlanWorkoutUpdateBody = trainingPlanWorkoutObject.partial().extend({
  completedAt: z.string().nullish(),
});

export const trainingPlanBaseBody = z.object({
  // Optional supplementary colour, not the primary intake field (Phase 14.1 —
  // race/distance/date/duration are now explicit structured fields instead).
  goalDescription: z.string().max(2000),
  startDate: isoDate,
  endDate: isoDate,
  daysPerWeek: z.number().int().min(1).max(7),
  isRace: z.boolean().optional(),
  goalRaceDistanceM: z.number().positive().nullish(),
  goalTargetDurationS: z.number().positive().nullish(),
});

export const trainingPlanBody = trainingPlanBaseBody
  .extend({ workouts: z.array(trainingPlanWorkoutBody).max(200).optional() })
  .refine(withinHorizon, { message: `plan cannot exceed ${MAX_HORIZON_DAYS} days`, path: ['endDate'] })
  .refine(workoutsWithinWindow, { message: 'workout dates must fall within the plan window', path: ['workouts'] });

/** Just the AI's actual output — dates/race facts are supplied by the user, not proposed by the model. */
export const aiProposedPlanSchema = z.object({
  rationale: z.string().max(2000).optional(),
  workouts: z.array(trainingPlanWorkoutBody).min(1).max(200),
});

export const generateTrainingPlanBody = z
  .object({
    goalDescription: z.string().max(2000).optional(),
    isRace: z.boolean(),
    goalRaceDistanceM: z.number().positive().nullish(),
    goalTargetDurationS: z.number().positive().nullish(),
    raceDate: isoDate.optional(),
    startDate: isoDate,
    durationWeeks: z.number().int().min(1).max(MAX_HORIZON_DAYS / 7).optional(),
    daysPerWeek: z.number().int().min(1).max(7),
    preferredDays: z.array(dayCodeSchema).optional(),
    preferredLongRunDay: dayCodeSchema.optional(),
    autofill: z
      .object({
        weeklyVolumeAvgKm: z.number().nonnegative().nullish(),
        longestRecentRunKm: z.number().nonnegative().nullish(),
        vo2max: z.number().nonnegative().nullish(),
        nonRunningLoadSummary: z.string().max(500).nullish(),
        paceNotes: z.string().max(500).nullish(),
      })
      .optional(),
    otherTraining: z.string().max(2000).optional(),
    upcomingNotes: z.string().max(2000).optional(),
  })
  .refine((p) => !p.isRace || (p.raceDate != null && p.goalRaceDistanceM != null), {
    message: 'raceDate and goalRaceDistanceM are required when isRace is true',
    path: ['raceDate'],
  })
  .refine((p) => p.isRace || p.durationWeeks != null, {
    message: 'durationWeeks is required when isRace is false',
    path: ['durationWeeks'],
  })
  .refine((p) => !p.isRace || !p.raceDate || withinHorizon({ startDate: p.startDate, endDate: p.raceDate }), {
    message: `race date cannot be more than ${MAX_HORIZON_DAYS} days after startDate`,
    path: ['raceDate'],
  });
