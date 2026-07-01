import { z } from 'zod';
import { WORKOUT_TYPES } from '@fitness/shared';
import { isoDate } from '../routes/validation.js';

/** 12 weeks — matches realistic usage and keeps AI generation calls small. */
export const MAX_HORIZON_DAYS = 84;

export const workoutTypeSchema = z.enum(WORKOUT_TYPES);

export const trainingPlanWorkoutBody = z.object({
  date: isoDate,
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  workoutType: workoutTypeSchema,
  targetDistanceM: z.number().nonnegative().nullish(),
  targetDurationS: z.number().nonnegative().nullish(),
  targetPaceSecPerKm: z.number().nonnegative().nullish(),
  notes: z.string().max(2000).nullish(),
});

export const trainingPlanWorkoutUpdateBody = trainingPlanWorkoutBody.partial().extend({
  completedAt: z.string().nullish(),
});

function withinHorizon(p: { startDate: string; endDate: string }): boolean {
  const days = (Date.parse(p.endDate) - Date.parse(p.startDate)) / 86_400_000;
  return days >= 0 && days <= MAX_HORIZON_DAYS;
}

export const trainingPlanBaseBody = z.object({
  goalDescription: z.string().min(1).max(2000),
  startDate: isoDate,
  endDate: isoDate,
  daysPerWeek: z.number().int().min(1).max(7),
  isRace: z.boolean().optional(),
  goalRaceDistanceM: z.number().positive().nullish(),
  goalTargetDurationS: z.number().positive().nullish(),
});

export const trainingPlanBody = trainingPlanBaseBody
  .extend({ workouts: z.array(trainingPlanWorkoutBody).max(200).optional() })
  .refine(withinHorizon, { message: `plan cannot exceed ${MAX_HORIZON_DAYS} days`, path: ['endDate'] });

export const generatedPlanSchema = trainingPlanBaseBody
  .required({ isRace: true })
  .extend({
    rationale: z.string().max(2000).optional(),
    workouts: z.array(trainingPlanWorkoutBody).min(1).max(200),
  })
  .refine(withinHorizon, { message: `plan cannot exceed ${MAX_HORIZON_DAYS} days`, path: ['endDate'] });

export const generateTrainingPlanBody = trainingPlanBaseBody
  .pick({ goalDescription: true, startDate: true, endDate: true, daysPerWeek: true })
  .extend({
    autofill: z
      .object({
        weeklyVolumeKm: z.number().nonnegative().nullish(),
        longestRecentRunKm: z.number().nonnegative().nullish(),
        relevantPace: z.string().max(500).nullish(),
        vo2max: z.number().nonnegative().nullish(),
        trainingLoadSummary: z.string().max(500).nullish(),
        readinessScore: z.number().nullish(),
        nonRunningLoadSummary: z.string().max(500).nullish(),
      })
      .optional(),
    otherTraining: z.string().max(2000).optional(),
    upcomingNotes: z.string().max(2000).optional(),
  })
  .refine(withinHorizon, { message: `plan cannot exceed ${MAX_HORIZON_DAYS} days`, path: ['endDate'] });
