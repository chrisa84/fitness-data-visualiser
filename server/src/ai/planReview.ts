import type OpenAI from 'openai';
import { WORKOUT_TYPES } from '@fitness/shared';
import type {
  CalendarEvent,
  PlanReviewFeeling,
  ProposedPlanAdjustment,
  TrainingPlan,
  TrainingPlanAutofill,
  TrainingPlanWorkout,
  TrainingPlanWorkoutInput,
} from '@fitness/shared';
import type { CompletionClient } from './chat.js';
import { daysBeforeISO, mmss, round1, PLAN_DATA_TOOLS } from './planGeneration.js';
import { executeTool, type ToolContext } from './tools.js';
import { aiProposedPlanAdjustmentSchema } from '../schemas/trainingPlan.js';
import { assertMergedWorkoutValid, WorkoutValidationError } from '../repositories/trainingPlans.js';

const MAX_STEPS = 8;
const ISO_DATE = { type: 'string', description: 'date as YYYY-MM-DD' } as const;

/** Thrown when the model fails to produce a valid `propose_plan_adjustment` call, or the proposal violates a hard protection. */
export class PlanReviewError extends Error {}

function addDaysUTC(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `date`. */
function weekStartOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dayIndex = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dayIndex);
  return d.toISOString().slice(0, 10);
}

/** Prescribed weekly running volume from the plan's own workouts, zero-omitted (rest weeks just don't appear). */
function plannedWeeklyVolume(workouts: TrainingPlanWorkout[]): { weekStart: string; distanceKm: number }[] {
  const byWeek = new Map<string, number>();
  for (const w of workouts) {
    if (w.targetDistanceM == null) continue;
    const week = weekStartOf(w.date);
    byWeek.set(week, (byWeek.get(week) ?? 0) + w.targetDistanceM);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([weekStart, distanceM]) => ({ weekStart, distanceKm: round1(distanceM / 1000) }));
}

function workoutStatusLine(w: TrainingPlanWorkout, today: string): string {
  const status = w.completedAt != null ? 'completed' : w.date < today ? 'MISSED' : 'due';
  const distance = w.targetDistanceM != null ? `${round1(w.targetDistanceM / 1000)}km` : null;
  return [w.date, status, w.workoutType, `"${w.title}"`, distance].filter((v): v is string => Boolean(v)).join(' ');
}

/** Full detail plus the workout's real ID — the model must reference this exact ID to modify/remove it. */
function formatScopedWorkoutForPrompt(w: TrainingPlanWorkout): string {
  const distance = w.targetDistanceM != null ? `${round1(w.targetDistanceM / 1000)}km` : null;
  const duration = w.targetDurationS != null ? mmss(w.targetDurationS) : null;
  const pace =
    w.targetPaceMinSecPerKm != null || w.targetPaceMaxSecPerKm != null
      ? `${w.targetPaceMinSecPerKm != null ? mmss(w.targetPaceMinSecPerKm) : '?'}-${w.targetPaceMaxSecPerKm != null ? mmss(w.targetPaceMaxSecPerKm) : '?'}/km`
      : w.targetPaceSecPerKm != null
        ? `${mmss(w.targetPaceSecPerKm)}/km`
        : null;
  return [
    `id:${w.id}`,
    w.date,
    w.workoutType,
    `"${w.title}"`,
    distance,
    duration,
    pace,
    w.description ? `desc:"${w.description}"` : null,
    w.notes ? `notes:"${w.notes}"` : null,
  ]
    .filter((v): v is string => Boolean(v))
    .join(' ');
}

const PROPOSE_PLAN_ADJUSTMENT_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'propose_plan_adjustment',
    description:
      'Terminal call: submit your reviewed adjustment for the plan — this may propose zero changes if nothing needs adjusting. Call this exactly once, as your final action, referencing only workout IDs listed below.',
    parameters: {
      type: 'object',
      properties: {
        overallAssessment: { type: 'string', description: 'brief overall verdict on how training is going so far' },
        adjustmentReason: { type: 'string', description: 'brief explanation of why these changes (or no changes) are being proposed' },
        modify: {
          type: 'array',
          description: 'changes to existing future, incomplete workouts within the reviewed scope, referenced by their exact ID',
          items: {
            type: 'object',
            properties: {
              workoutId: { type: 'number', description: 'the exact numeric id of an existing workout listed below — never invent one' },
              patch: {
                type: 'object',
                description: 'only the fields that change — omit anything staying the same',
                properties: {
                  date: ISO_DATE,
                  title: { type: 'string' },
                  description: { type: 'string' },
                  workoutType: { type: 'string', enum: WORKOUT_TYPES.filter((t) => t !== 'race') },
                  targetDistanceM: { type: 'number', description: 'metres, never kilometres' },
                  targetDurationS: { type: 'number', description: 'seconds, never minutes' },
                  targetPaceSecPerKm: { type: 'number' },
                  targetPaceMinSecPerKm: { type: 'number', description: 'numerically SMALLER/FASTER end of the range' },
                  targetPaceMaxSecPerKm: { type: 'number', description: 'numerically LARGER/SLOWER end of the range' },
                  notes: { type: 'string' },
                },
              },
              explanation: { type: 'string', description: 'why this specific workout is changing' },
            },
            required: ['workoutId', 'patch', 'explanation'],
          },
        },
        remove: {
          type: 'array',
          description: 'existing future, incomplete workouts to drop entirely, referenced by their exact ID',
          items: {
            type: 'object',
            properties: {
              workoutId: { type: 'number', description: 'the exact numeric id of an existing workout listed below' },
              explanation: { type: 'string' },
            },
            required: ['workoutId', 'explanation'],
          },
        },
        add: {
          type: 'array',
          description: 'brand new workouts to add within the reviewed scope window',
          items: {
            type: 'object',
            properties: {
              date: ISO_DATE,
              title: { type: 'string' },
              description: { type: 'string' },
              workoutType: { type: 'string', enum: WORKOUT_TYPES.filter((t) => t !== 'race') },
              targetDistanceM: { type: 'number' },
              targetDurationS: { type: 'number' },
              targetPaceSecPerKm: { type: 'number' },
              targetPaceMinSecPerKm: { type: 'number' },
              targetPaceMaxSecPerKm: { type: 'number' },
              notes: { type: 'string' },
              explanation: { type: 'string' },
            },
            required: ['date', 'title', 'workoutType', 'explanation'],
          },
        },
      },
      required: ['overallAssessment', 'adjustmentReason', 'modify', 'remove', 'add'],
    },
  },
};

/**
 * Builds the compact, fixed-size review prompt summary — reuses the same
 * repository functions as plan generation (autofill, events) plus the
 * plan's own workout roster, never raw daily rows.
 */
export function buildReviewSummary(opts: {
  plan: TrainingPlan;
  workouts: TrainingPlanWorkout[];
  inScopeWorkouts: TrainingPlanWorkout[];
  scope: 'next-week' | 'remaining';
  scopeStart: string;
  scopeEnd: string;
  feeling: PlanReviewFeeling;
  autofill: TrainingPlanAutofill;
  events: CalendarEvent[];
  today: string;
}): string {
  const { plan, workouts, inScopeWorkouts, scope, scopeStart, scopeEnd, feeling, autofill, events, today } = opts;
  const lines: string[] = [];

  if (plan.goalDescription) lines.push(`Goal: ${plan.goalDescription}`);
  if (plan.isRace) {
    lines.push(
      `This is a race${plan.goalRaceDistanceM != null ? `: ${round1(plan.goalRaceDistanceM / 1000)} km` : ''}` +
        `${plan.goalTargetDurationS != null ? `, target time ${mmss(plan.goalTargetDurationS)}` : ''}. Race day is ${plan.endDate}.`,
    );
  }
  lines.push(`Plan window: ${plan.startDate} to ${plan.endDate}. Today is ${today}.`);
  lines.push(
    `Reviewing scope: ${scope === 'next-week' ? 'next week' : 'the remaining plan'} (${scopeStart} to ${scopeEnd}). ` +
      'You may only modify/remove/add workouts within this window.',
  );
  lines.push(`The user reports feeling: ${feeling}.`);

  const past = workouts.filter((w) => w.date < today);
  const completed = past.filter((w) => w.completedAt != null);
  const missed = past.filter((w) => w.completedAt == null);
  lines.push(`Workouts so far: ${completed.length} completed, ${missed.length} missed (out of ${past.length} due).`);
  if (missed.length > 0) {
    lines.push(`Recently missed: ${missed.slice(-5).map((w) => workoutStatusLine(w, today)).join('; ')}.`);
  }

  const planned = plannedWeeklyVolume(workouts);
  if (planned.length > 0) {
    lines.push(`Prescribed weekly volume by week (oldest to newest): ${planned.map((w) => `${w.weekStart}: ${w.distanceKm}km`).join('; ')}.`);
  }
  if (autofill.weeklyVolumeTrend.length > 0) {
    lines.push(
      `Actual weekly running volume, last 6 complete weeks (oldest to newest): ${autofill.weeklyVolumeTrend.map((w) => `${w.weekStart}: ${w.distanceKm}km/${w.runCount} runs`).join('; ')}.`,
    );
  }

  if (autofill.representativeRuns.length > 0) {
    const runs = autofill.representativeRuns
      .map(
        (r) =>
          `${r.date} (${r.label.replace('_', ' ')}, ${r.type ?? 'unknown type'}): ${r.distanceKm}km in ${mmss(r.durationS)}` +
          `${r.avgPaceSecPerKm != null ? ` (${mmss(r.avgPaceSecPerKm)}/km)` : ''}`,
      )
      .join('; ');
    lines.push(`Representative recent runs: ${runs}.`);
  }

  if (autofill.trainingLoad.acute != null || autofill.trainingLoad.chronic != null) {
    const acwrTrend = autofill.trainingLoad.acwrTrend.length > 0 ? `, ACWR trend ${autofill.trainingLoad.acwrTrend.join(' → ')}` : '';
    lines.push(`Training load: acute ${autofill.trainingLoad.acute ?? '—'}, chronic ${autofill.trainingLoad.chronic ?? '—'}${acwrTrend}.`);
  }
  if (autofill.readinessScore != null) lines.push(`Readiness score: ${autofill.readinessScore}.`);

  if (events.length > 0) {
    const eventLines = events.map((e) => `${e.type} "${e.label}" ${e.date}${e.endDate ? `-${e.endDate}` : ''}`).join('; ');
    lines.push(`Logged events (recent + upcoming): ${eventLines}.`);
  }

  lines.push('');
  lines.push(
    inScopeWorkouts.length > 0
      ? `Workouts you may modify/remove (future, incomplete, within scope):\n${inScopeWorkouts.map((w) => `- ${formatScopedWorkoutForPrompt(w)}`).join('\n')}`
      : 'No future incomplete workouts fall within the reviewed scope.',
  );

  return lines.join('\n');
}

function systemPrompt(today: string, summary: string, isRace: boolean, notes?: string): string {
  return [
    `You are an experienced running coach embedded in a personal Garmin data app, reviewing an in-progress training plan. Today is ${today}.`,
    'The user asked you to review their plan given what has actually happened so far versus what was prescribed. Judge whether the remaining plan still makes sense, and propose a targeted adjustment if warranted — or explicitly propose no changes if things are on track. You have a few extra data tools if the summary is not enough, but it usually already covers what you need.',
    '',
    'Hard facts (already decided by the user, not yours to change):',
    '- You may only reference workout IDs from the "Workouts you may modify/remove" list above, and only add new workouts whose date falls within the reviewed scope window given above.',
    '- Never modify, remove, or add a workout of type "race", and never propose a new workout on or after the race date (if this is a race plan).',
    '- Do not touch anything already completed or dated in the past — it is not even offered to you above.',
    isRace
      ? "- This is a race. Do not schedule a long run, tempo, or interval session in the final 2 days before race day — easy or rest only in that window."
      : '',
    '',
    'Coaching rules:',
    '- Ground every change in the actual numbers in the summary (missed sessions, an actual-vs-prescribed volume gap, a readiness/load trend, a logged injury/illness) — never adjust just for the sake of it.',
    '- If the user reports feeling tired, struggling, or injured, weight that heavily — favour easing volume/intensity or inserting recovery over pushing on.',
    '- Keep hard efforts sparse: at most one tempo and one interval session per week, never on back-to-back days.',
    '- Prefer `modify` over `remove`+`add` when a session just needs a smaller/easier version rather than dropping it entirely.',
    '- Give every workout a pace target using the same field conventions as the original plan (min/max range for easy/long runs, real `description` structure for tempo/interval).',
    '',
    'In `overallAssessment` (2-3 sentences) summarise how training is going. In `adjustmentReason` explain the proposed change (or lack of one) in terms of the actual numbers above. Each individual modify/remove/add also needs its own short `explanation`.',
    'When ready, call propose_plan_adjustment exactly once with your full proposal.',
    '',
    notes ? `User-provided notes for this review (not saved anywhere else): ${notes}` : '',
    '',
    summary,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/** Just the AI's actual output, already zod-validated against `aiProposedPlanAdjustmentSchema`. */
export type AiProposedPlanAdjustment = ProposedPlanAdjustment;

/**
 * Runs a dedicated tool-use loop, mirroring `generatePlan`'s termination
 * pattern: `tool_choice` is `'auto'` with the plan-data tool set on every
 * step except the last allowed one, where the tool list narrows to just
 * `propose_plan_adjustment` and `tool_choice` becomes `'required'`.
 */
export async function reviewPlan(opts: {
  client: CompletionClient;
  model: string;
  ctx: ToolContext;
  today?: string;
  summary: string;
  isRace: boolean;
  notes?: string;
}): Promise<AiProposedPlanAdjustment> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const tools = [...PLAN_DATA_TOOLS, PROPOSE_PLAN_ADJUSTMENT_TOOL];
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt(today, opts.summary, opts.isRace, opts.notes) },
  ];

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const forced = step === MAX_STEPS - 1;
    const resp = await opts.client.chat.completions.create({
      model: opts.model,
      messages,
      tools: forced ? [PROPOSE_PLAN_ADJUSTMENT_TOOL] : tools,
      tool_choice: forced ? 'required' : 'auto',
    });
    const msg = resp.choices?.[0]?.message;
    if (!msg) throw new PlanReviewError('no response from model');
    messages.push(msg);

    const proposeCall = msg.tool_calls?.find(
      (call) => call.type === 'function' && call.function.name === 'propose_plan_adjustment',
    );
    if (proposeCall && proposeCall.type === 'function') {
      let args: unknown;
      try {
        args = JSON.parse(proposeCall.function.arguments || '{}');
      } catch {
        throw new PlanReviewError('propose_plan_adjustment arguments were not valid JSON');
      }
      const parsed = aiProposedPlanAdjustmentSchema.safeParse(args);
      if (!parsed.success) {
        throw new PlanReviewError(`propose_plan_adjustment arguments were invalid: ${parsed.error.message}`);
      }
      return parsed.data;
    }

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      messages.push({ role: 'user', content: 'Continue and finish by calling propose_plan_adjustment.' });
      continue;
    }

    for (const call of msg.tool_calls) {
      if (call.type !== 'function') continue;
      let result: unknown;
      try {
        const args = JSON.parse(call.function.arguments || '{}');
        result = executeTool(call.function.name, args, opts.ctx);
      } catch (e) {
        result = { error: (e as Error).message };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  throw new PlanReviewError('model did not produce a valid adjustment within the step limit');
}

/**
 * Deterministic hard protections, checked after a valid `propose_plan_adjustment`
 * parse (and again, independently, at apply time — see `applyPlanReview` —
 * since state may have changed between preview and apply). Mirrors
 * `generatePlan`'s pattern: schema validation alone isn't enough, the model
 * can still reference a stale/wrong ID or a merged result that breaks a
 * coaching invariant.
 */
export function validateProposedAdjustment(opts: {
  plan: TrainingPlan;
  workouts: TrainingPlanWorkout[];
  scopeStart: string;
  scopeEnd: string;
  adjustment: AiProposedPlanAdjustment;
}): void {
  const { plan, workouts, scopeStart, scopeEnd, adjustment } = opts;
  const byId = new Map(workouts.map((w) => [w.id, w]));

  const assertTouchable = (workoutId: number, action: 'modified' | 'removed'): TrainingPlanWorkout => {
    const existing = byId.get(workoutId);
    if (!existing) throw new PlanReviewError(`workout ${workoutId} does not belong to this plan`);
    if (existing.completedAt != null) throw new PlanReviewError(`workout ${workoutId} is already completed and cannot be ${action}`);
    if (existing.date < scopeStart || existing.date > scopeEnd) {
      throw new PlanReviewError(`workout ${workoutId} on ${existing.date} falls outside the reviewed scope ${scopeStart}–${scopeEnd}`);
    }
    if (existing.workoutType === 'race') throw new PlanReviewError('the race-day workout cannot be modified or removed');
    return existing;
  };

  for (const m of adjustment.modify) {
    const existing = assertTouchable(m.workoutId, 'modified');
    if (m.patch.workoutType === 'race') throw new PlanReviewError('cannot change a workout to type race');
    const merged: TrainingPlanWorkout = { ...existing, ...m.patch };
    try {
      assertMergedWorkoutValid(plan, merged);
    } catch (e) {
      if (e instanceof WorkoutValidationError) throw new PlanReviewError(e.message);
      throw e;
    }
  }

  for (const r of adjustment.remove) {
    assertTouchable(r.workoutId, 'removed');
  }

  for (const a of adjustment.add) {
    if (a.workoutType === 'race') throw new PlanReviewError('cannot add another race-day workout');
    if (a.date < scopeStart || a.date > scopeEnd) {
      throw new PlanReviewError(`new workout on ${a.date} falls outside the reviewed scope ${scopeStart}–${scopeEnd}`);
    }
    const synthetic: TrainingPlanWorkout = {
      id: 0,
      planId: plan.id,
      createdAt: '',
      completedAt: null,
      description: null,
      notes: null,
      targetDistanceM: null,
      targetDurationS: null,
      targetPaceSecPerKm: null,
      targetPaceMinSecPerKm: null,
      targetPaceMaxSecPerKm: null,
      ...(a as TrainingPlanWorkoutInput),
    };
    try {
      assertMergedWorkoutValid(plan, synthetic);
    } catch (e) {
      if (e instanceof WorkoutValidationError) throw new PlanReviewError(e.message);
      throw e;
    }
  }

  if (plan.isRace) {
    const removedIds = new Set(adjustment.remove.map((r) => r.workoutId));
    const patchById = new Map(adjustment.modify.map((m) => [m.workoutId, m.patch]));
    const resulting: { date: string; workoutType: string }[] = [
      ...workouts
        .filter((w) => !removedIds.has(w.id))
        .map((w) => (patchById.has(w.id) ? { ...w, ...patchById.get(w.id) } : w)),
      ...adjustment.add,
    ];
    const cutoff = daysBeforeISO(plan.endDate, 2);
    const tooClose = resulting.find(
      (w) => w.date >= cutoff && w.date < plan.endDate && ['long', 'tempo', 'interval'].includes(w.workoutType),
    );
    if (tooClose) {
      throw new PlanReviewError(`hard/long session on ${tooClose.date} is too close to race day (${plan.endDate})`);
    }
  }
}
