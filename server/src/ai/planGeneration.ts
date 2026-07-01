import type OpenAI from 'openai';
import { WORKOUT_TYPES, type CalendarEvent, type GenerateTrainingPlanRequest, type GeneratedTrainingPlan } from '@fitness/shared';
import type { CompletionClient } from './chat.js';
import { TOOL_DEFINITIONS, executeTool, type ToolContext } from './tools.js';
import { generatedPlanSchema } from '../schemas/trainingPlan.js';

const MAX_STEPS = 8;

const ISO_DATE = { type: 'string', description: 'date as YYYY-MM-DD' } as const;

/** Thrown when the model fails to produce a valid `propose_plan` call within the step limit. */
export class PlanGenerationError extends Error {}

/**
 * Only the tools actually relevant to plan design — not the full chat toolset.
 * The autofill summary already covers records/performance/volume/events; this
 * is just an escape hatch for a longer look-back, not a general research kit.
 * Keeping the per-request tool schema small matters for weaker/cheaper models,
 * which are more likely to time out or return a malformed response when asked
 * to juggle a dozen tool schemas plus a large structured output in one go.
 */
const PLAN_TOOL_NAMES = ['get_records', 'get_performance_series', 'get_activity_volume', 'list_events'];
const PLAN_DATA_TOOLS = TOOL_DEFINITIONS.filter(
  (t) => t.type === 'function' && PLAN_TOOL_NAMES.includes(t.function.name),
);

const PROPOSE_PLAN_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'propose_plan',
    description:
      'Terminal call: submit the finished training plan. Call this exactly once, as your final action, with the complete workout list — do not answer in free text.',
    parameters: {
      type: 'object',
      properties: {
        goalDescription: { type: 'string' },
        isRace: { type: 'boolean', description: 'true only if the goal is a specific race with a target date/time' },
        goalRaceDistanceM: { type: 'number', description: 'race distance in metres; omit if not a race' },
        goalTargetDurationS: { type: 'number', description: 'target finish time in seconds; omit if not a race' },
        startDate: ISO_DATE,
        endDate: ISO_DATE,
        daysPerWeek: { type: 'integer' },
        rationale: { type: 'string', description: 'brief explanation of feasibility and the plan structure' },
        workouts: {
          type: 'array',
          description: 'one row per prescribed training day only — every other date is implicitly rest',
          items: {
            type: 'object',
            properties: {
              date: ISO_DATE,
              title: { type: 'string' },
              description: { type: 'string' },
              workoutType: { type: 'string', enum: WORKOUT_TYPES },
              targetDistanceM: { type: 'number', description: 'metres, e.g. 10000 for 10km — never kilometres' },
              targetDurationS: { type: 'number', description: 'seconds, e.g. 1800 for 30 minutes — never minutes' },
              targetPaceSecPerKm: { type: 'number', description: 'seconds per kilometre, e.g. 300 for 5:00/km' },
              notes: { type: 'string' },
            },
            required: ['date', 'title', 'workoutType'],
          },
        },
      },
      required: ['goalDescription', 'isRace', 'startDate', 'endDate', 'daysPerWeek', 'workouts'],
    },
  },
};

/** Builds the compact, fixed-size prompt summary — never raw daily rows. */
export function buildPlanSummary(input: GenerateTrainingPlanRequest, events: CalendarEvent[]): string {
  const lines = [
    `Goal: ${input.goalDescription}`,
    `Plan window: ${input.startDate} to ${input.endDate}, ${input.daysPerWeek} training days per week.`,
  ];
  const a = input.autofill;
  if (a?.weeklyVolumeKm != null) lines.push(`Recent weekly running volume: ~${a.weeklyVolumeKm} km/week.`);
  if (a?.longestRecentRunKm != null) lines.push(`Longest recent run: ${a.longestRecentRunKm} km.`);
  if (a?.relevantPace) lines.push(`Relevant recent pace/PR: ${a.relevantPace}.`);
  if (a?.vo2max != null) lines.push(`Current VO2max: ${a.vo2max}.`);
  if (a?.trainingLoadSummary) lines.push(`Training load: ${a.trainingLoadSummary}.`);
  if (a?.readinessScore != null) lines.push(`Readiness score: ${a.readinessScore}.`);
  if (a?.nonRunningLoadSummary) lines.push(`Other current training: ${a.nonRunningLoadSummary}.`);
  if (input.otherTraining) lines.push(`User-reported untracked training: ${input.otherTraining}.`);
  if (input.upcomingNotes) lines.push(`User-reported upcoming constraints: ${input.upcomingNotes}.`);
  if (events.length > 0) {
    const eventLines = events
      .map((e) => `${e.type} "${e.label}" ${e.date}${e.endDate ? `-${e.endDate}` : ''}`)
      .join('; ');
    lines.push(`Logged events overlapping this window: ${eventLines}.`);
  } else {
    lines.push('No logged events overlap this window.');
  }
  return lines.join('\n');
}

function systemPrompt(today: string, summary: string): string {
  return [
    `You are an experienced running coach embedded in a personal Garmin data app. Today is ${today}.`,
    'Design a training plan for the user described below, grounded in the fitness summary — not a generic template. You have a few extra data tools (records, performance trends, activity volume, logged events) if the summary genuinely is not enough, but it usually already covers what you need.',
    '',
    'Coaching rules:',
    '- Judge whether the stated goal is realistic in the time available given the fitness summary. If it looks like a stretch, or currently unachievable, say so plainly in `rationale` and propose the safest reasonable version of it (an easier pace target, or note the timeline is tight) rather than refusing to produce a plan.',
    '- If `isRace` is true, build progressive weekly volume toward the race and include a taper (reduced volume/intensity) in roughly the final 1-2 weeks before it. If it is not a race, skip the taper — progress volume/intensity gradually instead, with an easier week every few weeks rather than a constant ramp.',
    '- Keep hard efforts sparse: at most one tempo and one interval session per week, and never on back-to-back days. Include a weekly long run once the goal distance or weekly volume justifies one.',
    '- Only schedule the given number of training days per week — every other date is implicitly a rest day, do not create a workout row for it.',
    '- All numeric targets use the units named in the schema exactly (metres, seconds, seconds per kilometre) — never kilometres or minutes.',
    '',
    'In `rationale` (2-4 sentences), explain the plan in terms of the actual numbers in the summary below — name the specific figures that shaped a decision (e.g. "your weekly volume has been flat around X km, so the first two weeks stay conservative" or "readiness has been low, so I front-loaded easier sessions") rather than generic encouragement. If you flagged a feasibility concern above, repeat it here.',
    'When ready, call propose_plan exactly once with the complete plan.',
    '',
    summary,
  ].join('\n');
}

/**
 * Runs a dedicated tool-use loop (separate from `runChat`, which must stay
 * generic for ordinary chat) that forces termination in a `propose_plan`
 * call: `tool_choice` is `'auto'` on every step except the last allowed one,
 * where it is forced to `propose_plan` — forcing from step 0 would prevent
 * the model calling data tools first, since a forced single-function choice
 * disallows any other call that turn.
 */
export async function generatePlan(opts: {
  client: CompletionClient;
  model: string;
  ctx: ToolContext;
  today?: string;
  summary: string;
}): Promise<GeneratedTrainingPlan> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const tools = [...PLAN_DATA_TOOLS, PROPOSE_PLAN_TOOL];
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt(today, opts.summary) },
  ];

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const forced = step === MAX_STEPS - 1;
    const resp = await opts.client.chat.completions.create({
      model: opts.model,
      messages,
      tools,
      tool_choice: forced ? { type: 'function', function: { name: 'propose_plan' } } : 'auto',
    });
    // Guard against a malformed/degraded provider response (missing `choices`
    // entirely, not just an empty message) rather than crashing on `[0]`.
    const msg = resp.choices?.[0]?.message;
    if (!msg) throw new PlanGenerationError('no response from model');
    messages.push(msg);

    const proposeCall = msg.tool_calls?.find(
      (call) => call.type === 'function' && call.function.name === 'propose_plan',
    );
    if (proposeCall && proposeCall.type === 'function') {
      let args: unknown;
      try {
        args = JSON.parse(proposeCall.function.arguments || '{}');
      } catch {
        throw new PlanGenerationError('propose_plan arguments were not valid JSON');
      }
      const parsed = generatedPlanSchema.safeParse(args);
      if (!parsed.success) {
        throw new PlanGenerationError(`propose_plan arguments were invalid: ${parsed.error.message}`);
      }
      return {
        goalDescription: parsed.data.goalDescription,
        isRace: parsed.data.isRace,
        goalRaceDistanceM: parsed.data.goalRaceDistanceM ?? null,
        goalTargetDurationS: parsed.data.goalTargetDurationS ?? null,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        daysPerWeek: parsed.data.daysPerWeek,
        rationale: parsed.data.rationale,
        workouts: parsed.data.workouts,
      };
    }

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      // Free text before the forced step isn't a valid answer here — nudge and keep going.
      messages.push({ role: 'user', content: 'Continue and finish by calling propose_plan.' });
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

  throw new PlanGenerationError('model did not produce a valid plan within the step limit');
}
