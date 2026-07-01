import type OpenAI from 'openai';
import {
  WORKOUT_TYPES,
  type CalendarEvent,
  type GenerateTrainingPlanRequest,
  type TrainingPlanAutofill,
  type TrainingPlanWorkoutInput,
} from '@fitness/shared';
import type { CompletionClient } from './chat.js';
import { TOOL_DEFINITIONS, executeTool, type ToolContext } from './tools.js';
import { aiProposedPlanSchema } from '../schemas/trainingPlan.js';

const MAX_STEPS = 8;

const ISO_DATE = { type: 'string', description: 'date as YYYY-MM-DD' } as const;

/** Thrown when the model fails to produce a valid `propose_plan` call, or violates a hard coaching rule. */
export class PlanGenerationError extends Error {}

/** Just the AI's actual output — start/end dates and race facts are user-supplied, not proposed. */
export interface AiProposedPlan {
  rationale?: string;
  workouts: TrainingPlanWorkoutInput[];
}

/** The current unsaved draft plus what the user wants changed about it — see `systemPrompt`'s revision branch. */
export interface RevisionContext {
  currentWorkouts: TrainingPlanWorkoutInput[];
  currentRationale?: string;
  instructions: string;
}

/**
 * Only the tools actually relevant to plan design — not the full chat toolset.
 * The autofill summary already covers records/performance/volume/events; this
 * is just an escape hatch for a longer look-back, not a general research kit.
 * Keeping the per-request tool schema small matters for weaker/cheaper models,
 * which are more likely to time out or return a malformed response when asked
 * to juggle a dozen tool schemas plus a large structured output in one go.
 */
const PLAN_TOOL_NAMES = ['get_records', 'get_performance_series', 'get_activity_volume', 'list_events'];
export const PLAN_DATA_TOOLS = TOOL_DEFINITIONS.filter(
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
              targetPaceSecPerKm: {
                type: 'number',
                description: 'seconds per kilometre, point estimate, e.g. 300 for 5:00/km',
              },
              targetPaceMinSecPerKm: {
                type: 'number',
                description:
                  'seconds per km — the numerically SMALLER value, i.e. the FASTER end of a pace range (lower seconds/km = faster). Use for easy/long runs instead of a single pace.',
              },
              targetPaceMaxSecPerKm: {
                type: 'number',
                description:
                  'seconds per km — the numerically LARGER value, i.e. the SLOWER end of a pace range (higher seconds/km = slower).',
              },
              notes: { type: 'string' },
            },
            required: ['date', 'title', 'workoutType'],
          },
        },
      },
      required: ['workouts'],
    },
  },
};

/** Exported for reuse by `planReview.ts` (Phase 15A), which formats the same kind of values. */
export function mmss(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/** Exported for reuse by `planReview.ts`, which needs the same "N days before this date" check for race-day proximity. */
export function daysBeforeISO(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Full detail, not just date/type/title — a revision needs to see the
 * existing duration/description/notes to have any chance of preserving
 * them, since "keep everything else the same" is meaningless if the model
 * never saw what "everything else" actually contains.
 */
function formatWorkoutForPrompt(w: TrainingPlanWorkoutInput): string {
  const distance = w.targetDistanceM != null ? `${round1(w.targetDistanceM / 1000)}km` : null;
  const duration = w.targetDurationS != null ? mmss(w.targetDurationS) : null;
  const pace =
    w.targetPaceMinSecPerKm != null || w.targetPaceMaxSecPerKm != null
      ? `${w.targetPaceMinSecPerKm != null ? mmss(w.targetPaceMinSecPerKm) : '?'}-${w.targetPaceMaxSecPerKm != null ? mmss(w.targetPaceMaxSecPerKm) : '?'}/km`
      : w.targetPaceSecPerKm != null
        ? `${mmss(w.targetPaceSecPerKm)}/km`
        : null;
  return [
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

/**
 * Builds the compact, fixed-size prompt summary — never raw daily rows.
 * `endDate` is the route-computed date (race day, or startDate+durationWeeks),
 * never something the model chooses. `autofill` is always the fresh repository
 * result; `input.autofill` only carries the user's small set of overrides.
 */
export function buildPlanSummary(
  input: GenerateTrainingPlanRequest,
  endDate: string,
  autofill: TrainingPlanAutofill,
  events: CalendarEvent[],
): string {
  const lines: string[] = [];
  if (input.goalDescription) lines.push(`Goal notes: ${input.goalDescription}`);

  if (input.isRace) {
    const distanceKm = input.goalRaceDistanceM != null ? round1(input.goalRaceDistanceM / 1000) : null;
    lines.push(
      `This is a race${distanceKm != null ? `: ${distanceKm} km` : ''}` +
        `${input.goalTargetDurationS != null ? `, target time ${mmss(input.goalTargetDurationS)}` : ''}.`,
    );
    lines.push(`Race day is exactly ${endDate} — ${daysBetween(input.startDate, endDate)} days from the plan start.`);
  } else {
    lines.push('This is a general fitness goal, not tied to a specific race.');
  }

  lines.push(`Plan window: ${input.startDate} to ${endDate}, ${input.daysPerWeek} training days per week.`);
  if (input.preferredDays && input.preferredDays.length > 0) {
    lines.push(`Preferred training days (soft preference, not required): ${input.preferredDays.join(', ')}.`);
  }
  if (input.preferredLongRunDay) lines.push(`Preferred long-run day: ${input.preferredLongRunDay}.`);

  const avgVol = input.autofill?.weeklyVolumeAvgKm ?? autofill.weeklyVolumeAvgKm;
  if (avgVol != null) lines.push(`Recent weekly running volume: ~${avgVol} km/week (avg of the last 6 complete weeks).`);
  if (autofill.weeklyVolumeTrend.length > 0) {
    const trend = autofill.weeklyVolumeTrend.map((w) => `${w.weekStart}: ${w.distanceKm}km/${w.runCount} runs`).join('; ');
    lines.push(`Weekly volume trend (oldest to newest): ${trend}.`);
  }

  const longest = input.autofill?.longestRecentRunKm ?? autofill.longestRecentRunKm;
  if (longest != null) lines.push(`Longest recent run: ${longest} km (last 12 weeks).`);

  if (autofill.representativeRuns.length > 0) {
    const runs = autofill.representativeRuns
      .map(
        (r) =>
          `${r.date} (${r.label.replace('_', ' ')}, ${r.type ?? 'unknown type'}): ${r.distanceKm}km in ${mmss(r.durationS)}` +
          `${r.avgPaceSecPerKm != null ? ` (${mmss(r.avgPaceSecPerKm)}/km)` : ''}` +
          `${r.elevationGainM != null && r.elevationGainM > 0 ? `, +${Math.round(r.elevationGainM)}m climb` : ''}`,
      )
      .join('; ');
    lines.push(
      `Representative recent runs (last 3 months, varying length/intensity): ${runs}. Note the activity type and climb — trail/hilly pace is not comparable to flat road pace, don't set road-pace targets off a hilly effort.`,
    );
  }

  const vo2max = input.autofill?.vo2max ?? autofill.vo2max;
  if (vo2max != null) lines.push(`Current VO2max: ${vo2max}.`);

  if (autofill.trainingLoad.acute != null || autofill.trainingLoad.chronic != null) {
    const acwrTrend =
      autofill.trainingLoad.acwrTrend.length > 0 ? `, ACWR trend ${autofill.trainingLoad.acwrTrend.join(' → ')}` : '';
    lines.push(
      `Training load: acute ${autofill.trainingLoad.acute ?? '—'}, chronic ${autofill.trainingLoad.chronic ?? '—'}${acwrTrend}.`,
    );
  }
  if (autofill.readinessScore != null) lines.push(`Readiness score: ${autofill.readinessScore}.`);

  const rp = autofill.racePredictions;
  const predictions = [
    rp.race5kS != null ? `5k ${mmss(rp.race5kS)}` : null,
    rp.race10kS != null ? `10k ${mmss(rp.race10kS)}` : null,
    rp.raceHalfS != null ? `half ${mmss(rp.raceHalfS)}` : null,
    rp.raceFullS != null ? `full ${mmss(rp.raceFullS)}` : null,
  ].filter((v): v is string => v != null);
  if (predictions.length > 0) lines.push(`Predicted current race times: ${predictions.join(', ')}.`);

  const activeNonRunning = autofill.nonRunningLoad.filter((g) => g.count > 0);
  if (activeNonRunning.length > 0) {
    const nonRunning = activeNonRunning
      .map((g) => `${g.group} ${g.count}x/${g.distanceKm}km (avg ${round1(g.distanceKm / g.count)}km/session)`)
      .join('; ');
    lines.push(
      `Other current training (last 12 weeks): ${nonRunning}. A high session count with a low per-session average is likely incidental daily activity (e.g. auto-detected walks), not deliberate training — weigh it accordingly.`,
    );
  }
  if (input.autofill?.nonRunningLoadSummary) lines.push(`User note on other training: ${input.autofill.nonRunningLoadSummary}.`);
  if (input.autofill?.paceNotes) lines.push(`User note on recent pace/effort: ${input.autofill.paceNotes}.`);

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

function systemPrompt(today: string, summary: string, isRace: boolean, revision?: RevisionContext): string {
  return [
    `You are an experienced running coach embedded in a personal Garmin data app. Today is ${today}.`,
    revision
      ? "You previously proposed the training plan below. The user wants a targeted revision — you are editing it, not designing a fresh one. Keep everything not implicated by the requested change as close to the original as possible; don't regenerate parts nobody asked you to touch. The user's requested change follows as the next message."
      : 'Design a training plan for the user described below, grounded in the fitness summary — not a generic template. You have a few extra data tools (records, performance trends, activity volume, logged events) if the summary genuinely is not enough, but it usually already covers what you need.',
    ...(revision
      ? [
          '',
          'Current draft plan (revise this):',
          ...revision.currentWorkouts.map((w) => `- ${formatWorkoutForPrompt(w)}`),
          revision.currentRationale ? `Current rationale: ${revision.currentRationale}` : '',
        ]
      : []),
    '',
    'Hard facts (already decided by the user, not yours to change):',
    '- The plan window (start/end date) and whether this is a race, plus the race distance/target time if so, are given exactly below — do not reinterpret or move them.',
    isRace
      ? "- This is a race. The plan's end date IS race day. Schedule exactly one workoutType:'race' row on that exact date, and do not schedule a long run, tempo, or interval session in the final 2 days before it — easy or rest only in that window."
      : '- This is a general fitness goal, not a race — no taper needed, just steady progression with an easier week every few weeks rather than a constant ramp.',
    '- Every workout date must fall within the plan window (start date to end date) inclusive. Do not schedule anything outside it.',
    '',
    'Coaching rules:',
    '- Judge whether the stated goal is realistic in the time available given the fitness summary. If it looks like a stretch, or currently unachievable, say so plainly in `rationale` and propose the safest reasonable version of it (an easier pace target, or note the timeline is tight) rather than refusing to produce a plan.',
    '- Keep hard efforts sparse: at most one tempo and one interval session per week, and never on back-to-back days. Include a weekly long run once the goal distance or weekly volume justifies one.',
    '- Only schedule the given number of training days per week — every other date is implicitly a rest day, do not create a workout row for it.',
    '- If preferred training days are given, honor them where reasonable — they are a preference, not a hard requirement.',
    '- Give every workout a `targetPaceSecPerKm`. For easy and long runs a single pace is unrealistic — use `targetPaceMinSecPerKm`/`targetPaceMaxSecPerKm` for a range instead (or as well): `targetPaceMinSecPerKm` must be the numerically SMALLER/FASTER value and `targetPaceMaxSecPerKm` the numerically LARGER/SLOWER value (seconds per km — fewer seconds means faster). For tempo/interval workouts also give `targetDurationS` or `targetDistanceM` for the effort itself, and use `description` for real structure (e.g. "6x800m @ pace w/ 3min jog recovery") — a bare distance is not enough for a hard session.',
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
 * call: `tool_choice` is `'auto'` with the full plan-data tool set on every
 * step except the last allowed one, where the tool list is narrowed to just
 * `propose_plan` and `tool_choice` is set to `'required'`.
 *
 * `'required'` (call *some* tool) rather than the named-function form
 * (`{type:'function', function:{name:'propose_plan'}}`) deliberately —
 * forcing one specific function by name needs each provider/aggregator to
 * correctly translate that exact semantic, which is a known weak spot for
 * non-OpenAI-native backends (Gemini, DeepSeek, etc. routed through
 * OpenRouter). `'required'` is the older, far more universally supported
 * part of the tool-choice spec, and narrowing the tool list to one entry
 * makes it unambiguous without needing the named-function form at all.
 *
 * After a valid `propose_plan` call parses, a few coaching rules that are
 * cheap and unambiguous to check mechanically (workout dates inside the
 * plan window — the schema-level `workoutsWithinWindow` refine doesn't
 * apply here since this schema has no startDate/endDate of its own; race
 * day placement; no hard/long session immediately before race day) are
 * enforced deterministically rather than left to the model — a violation
 * throws `PlanGenerationError` (same 502 path as any other generation
 * failure, no repair/retry pass).
 */
export async function generatePlan(opts: {
  client: CompletionClient;
  model: string;
  ctx: ToolContext;
  today?: string;
  summary: string;
  startDate: string;
  endDate: string;
  isRace: boolean;
  revision?: RevisionContext;
}): Promise<AiProposedPlan> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const tools = [...PLAN_DATA_TOOLS, PROPOSE_PLAN_TOOL];
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt(today, opts.summary, opts.isRace, opts.revision) },
  ];
  // The stable preservation rules live in the system prompt above; the user's actual
  // per-request ask is a genuine user-role turn, not buried inside the system message.
  if (opts.revision) {
    messages.push({ role: 'user', content: opts.revision.instructions });
  }

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const forced = step === MAX_STEPS - 1;
    const resp = await opts.client.chat.completions.create({
      model: opts.model,
      messages,
      tools: forced ? [PROPOSE_PLAN_TOOL] : tools,
      tool_choice: forced ? 'required' : 'auto',
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
      const parsed = aiProposedPlanSchema.safeParse(args);
      if (!parsed.success) {
        throw new PlanGenerationError(`propose_plan arguments were invalid: ${parsed.error.message}`);
      }
      const { workouts } = parsed.data;

      for (const w of workouts) {
        if (w.date < opts.startDate || w.date > opts.endDate) {
          throw new PlanGenerationError(`workout on ${w.date} falls outside the plan window ${opts.startDate}–${opts.endDate}`);
        }
      }
      if (opts.isRace) {
        const raceRows = workouts.filter((w) => w.workoutType === 'race');
        if (raceRows.length !== 1 || raceRows[0]!.date !== opts.endDate) {
          throw new PlanGenerationError('the race workout must fall exactly once, on the race date');
        }
        const cutoff = daysBeforeISO(opts.endDate, 2);
        const tooClose = workouts.find(
          (w) => w.date >= cutoff && w.date < opts.endDate && ['long', 'tempo', 'interval'].includes(w.workoutType),
        );
        if (tooClose) {
          throw new PlanGenerationError(`hard/long session on ${tooClose.date} is too close to race day (${opts.endDate})`);
        }
      }

      return { rationale: parsed.data.rationale, workouts };
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
