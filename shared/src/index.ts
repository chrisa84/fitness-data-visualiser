/**
 * App version — the single source of truth, imported by both server and web
 * (no runtime package.json reads, so it survives the Docker bundle). Scheme:
 * 0.<phase>.<patch> — the minor tracks the PLAN.md phase that shipped, the
 * patch is for fixes between phases. Bump this and add a CHANGELOG.md entry
 * with every user-visible change.
 */
export const APP_VERSION = '0.21.2';

export type Granularity = 'day' | 'week' | 'month' | 'year';

export const GRANULARITIES: readonly Granularity[] = ['day', 'week', 'month', 'year'];

/**
 * One bucket of the daily-health series. For granularity=day, `date` is the
 * day itself; for coarser granularities it is the first date present in the
 * bucket and numeric fields are averages over the bucket (days without data
 * are excluded from each average).
 */
export interface DailyHealthPoint {
  date: string;
  restingHr: number | null;
  totalSteps: number | null;
  avgStressLevel: number | null;
  sleepScore: number | null;
  sleepTotalS: number | null;
  sleepDeepS: number | null;
  sleepLightS: number | null;
  sleepRemS: number | null;
  sleepAwakeS: number | null;
  hrvNightly: number | null;
  hrvWeekly: number | null;
  hrvBaselineLow: number | null;
  hrvBaselineHigh: number | null;
  bodyBatteryCharged: number | null;
  bodyBatteryDrained: number | null;
  bodyBatteryHigh: number | null;
  bodyBatteryLow: number | null;
  moderateIntensityMin: number | null;
  vigorousIntensityMin: number | null;
}

export interface DailyHealthResponse {
  from: string;
  to: string;
  granularity: Granularity;
  points: DailyHealthPoint[];
}

export interface ApiErrorBody {
  error: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

export const ACTIVITY_SORT_KEYS = ['start_time', 'distance', 'duration', 'avg_hr'] as const;
export type ActivitySortKey = (typeof ACTIVITY_SORT_KEYS)[number];

/**
 * Named groups of Garmin activity types, so a single filter can mean "all
 * running" across its subtypes. Membership lives here, shared by the server
 * (which resolves a group into a `type IN (...)` set) and the web filter
 * dropdowns. Adding a new Garmin subtype only requires extending the relevant
 * `types` list.
 */
export interface ActivityGroup {
  key: string;
  label: string;
  types: string[];
}

export const ACTIVITY_GROUPS: readonly ActivityGroup[] = [
  { key: 'running', label: 'All running', types: ['running', 'trail_running', 'treadmill_running', 'obstacle_run'] },
  { key: 'cycling', label: 'All cycling', types: ['cycling', 'indoor_cycling'] },
  { key: 'swimming', label: 'All swimming', types: ['lap_swimming', 'open_water_swimming'] },
  { key: 'walking', label: 'All walking', types: ['walking', 'hiking'] },
];

/** Filter values that name a group carry this prefix, e.g. `group:running`. */
export const GROUP_PREFIX = 'group:';

export function activityGroupOptionValue(key: string): string {
  return `${GROUP_PREFIX}${key}`;
}

/**
 * Resolves a filter value into the set of concrete activity types to match.
 * - undefined / empty  → undefined (no type filter, i.e. all activities)
 * - `group:running`    → the group's member types
 * - `running`          → `['running']` (exact match)
 * An unknown group key resolves to undefined rather than erroring, so a stale
 * URL degrades to "all" instead of an empty result.
 */
export function resolveActivityTypeFilter(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  if (value.startsWith(GROUP_PREFIX)) {
    const key = value.slice(GROUP_PREFIX.length);
    const group = ACTIVITY_GROUPS.find((g) => g.key === key);
    return group ? [...group.types] : undefined;
  }
  return [value];
}

export interface ActivityListItem {
  activityId: string;
  name: string | null;
  type: string | null;
  startTimeLocal: string | null;
  distanceM: number | null;
  durationS: number | null;
  movingDurationS: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgSpeedMps: number | null;
  elevationGainM: number | null;
  calories: number | null;
  aerobicTe: number | null;
  anaerobicTe: number | null;
  trainingLoad: number | null;
  /**
   * Ids of the user's own tags on this activity. Tags live in the writable
   * events DB, so the repository (which only sees the read-only Garmin DB)
   * always returns `[]` here — the route overlays the real values.
   */
  tagIds: number[];
}

export interface ActivityListResponse {
  total: number;
  limit: number;
  offset: number;
  items: ActivityListItem[];
}

export interface ActivityTypeCount {
  type: string;
  count: number;
}

export interface ActivitySplit {
  splitIndex: number;
  splitType: string | null;
  distanceM: number | null;
  durationS: number | null;
  movingDurationS: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgSpeedMps: number | null;
  avgCadence: number | null;
  avgPower: number | null;
  calories: number | null;
  elevationGainM: number | null;
  elevationLossM: number | null;
  groundContactMs: number | null;
  verticalOscillationCm: number | null;
}

export interface ActivityDetail extends ActivityListItem {
  startTime: string | null;
  elapsedDurationS: number | null;
  avgCadence: number | null;
  maxCadence: number | null;
  avgPower: number | null;
  maxPower: number | null;
  normPower: number | null;
  maxSpeedMps: number | null;
  elevationLossM: number | null;
  vo2max: number | null;
  activitySteps: number | null;
  bodyBatteryDelta: number | null;
  avgRespirationRate: number | null;
  hrZone1S: number | null;
  hrZone2S: number | null;
  hrZone3S: number | null;
  hrZone4S: number | null;
  hrZone5S: number | null;
  fastestKmS: number | null;
  fastest5kS: number | null;
  tempAvgC: number | null;
  waterEstimatedMl: number | null;
  staminaStart: number | null;
  staminaEnd: number | null;
  staminaMin: number | null;
  groundContactMs: number | null;
  groundContactBalanceLeft: number | null;
  verticalOscillationCm: number | null;
  verticalRatioPct: number | null;
  strideLengthCm: number | null;
  splits: ActivitySplit[];
}

// ---------------------------------------------------------------------------
// Activity samples (time-series)
// ---------------------------------------------------------------------------

export interface ActivitySample {
  sampleIndex: number;
  timestampUtc?: string;
  distanceM: number | null;
  heartRate: number | null;
  speedMps: number | null;
  cadence: number | null;
  powerW: number | null;
  altitudeM: number | null;
  lat: number | null;
  lon: number | null;
  respirationRate: number | null;
  groundContactMs: number | null;
  groundContactBalanceLeft: number | null;
  verticalOscillationCm: number | null;
  verticalRatioPct: number | null;
  strideLengthCm: number | null;
}

/** A stretch where wrist HR has probably locked on to arm swing (cadence) instead of the pulse. */
export interface CadenceLockSegment {
  startIdx: number;
  endIdx: number;
  durationS: number;
}

/**
 * Find stretches where optical HR reads the stride rate: while moving, HR at least 15 bpm below the
 * activity's moving median and within 5 of cadence, for at least 40% of moving samples in a ±60 s window,
 * lasting 60 s or more. It targets the obvious case: a sudden 20–40 bpm drop onto the cadence line at
 * an unchanged pace. Only the low-side lock is detected; a lock that reads high looks like hard effort.
 */
export function findCadenceLock(samples: readonly ActivitySample[]): CadenceLockSegment[] {
  const t = samples.map((s) => (s.timestampUtc ? Date.parse(s.timestampUtc) / 1000 : NaN));
  if (samples.length < 30 || t.some((v) => Number.isNaN(v))) return [];
  const moving = samples.map((s) => s.speedMps != null && s.speedMps >= 0.7 && s.heartRate != null);
  const hrs = samples.filter((_, i) => moving[i]).map((s) => s.heartRate!).sort((a, b) => a - b);
  if (hrs.length < 30) return [];
  const ref = hrs[Math.floor(hrs.length / 2)]!;
  const cand = samples.map(
    (s, i) => moving[i]! && s.cadence != null && s.heartRate! <= ref - 15 && Math.abs(s.heartRate! - s.cadence) <= 5,
  );
  // Prefix sums, so the share of candidates in any time window is two subtractions.
  const candSum = [0];
  const movingSum = [0];
  for (let i = 0; i < samples.length; i++) {
    candSum.push(candSum[i]! + (cand[i] ? 1 : 0));
    movingSum.push(movingSum[i]! + (moving[i] ? 1 : 0));
  }
  const firstAtOrAfter = (x: number): number => {
    let lo = 0;
    let hi = t.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (t[mid]! < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const flagged: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    if (!cand[i]) continue;
    const lo = firstAtOrAfter(t[i]! - 60);
    const hi = firstAtOrAfter(t[i]! + 60.001);
    const share = (candSum[hi]! - candSum[lo]!) / Math.max(movingSum[hi]! - movingSum[lo]!, 1);
    if (share >= 0.4) flagged.push(i);
  }
  const out: CadenceLockSegment[] = [];
  let start = flagged[0], prev = flagged[0];
  for (const i of [...flagged.slice(1), undefined]) {
    if (i !== undefined && t[i]! - t[prev!]! <= 60) { prev = i; continue; }
    if (start !== undefined && t[prev!]! - t[start]! >= 60) {
      out.push({ startIdx: start, endIdx: prev!, durationS: Math.round(t[prev!]! - t[start]!) });
    }
    start = prev = i;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

export interface VolumePoint {
  date: string;
  count: number;
  distanceM: number;
  durationS: number;
  elevationGainM: number;
}

export interface VolumeResponse {
  from: string;
  to: string;
  granularity: Granularity;
  type: string | null;
  points: VolumePoint[];
}

// ---------------------------------------------------------------------------
// Performance & training
// ---------------------------------------------------------------------------

/**
 * One day (or aggregated bucket) of date-keyed performance metrics, joined
 * across training_status, training_readiness, race_predictions, max_metrics,
 * lactate_threshold, endurance_score, hill_score and fitness_age. Every metric
 * is independently nullable — Garmin records them on different cadences.
 * `trainingStatus` is only populated at day granularity (a text phrase can't
 * be averaged).
 */
export interface PerformancePoint {
  date: string;
  vo2max: number | null;
  vo2maxPrecise: number | null;
  fitnessAge: number | null;
  acuteLoad: number | null;
  chronicLoad: number | null;
  acwr: number | null;
  trainingStatus: string | null;
  readinessScore: number | null;
  readinessHrvPct: number | null;
  readinessSleepPct: number | null;
  readinessStressPct: number | null;
  recoveryTimeMin: number | null;
  race5kS: number | null;
  race10kS: number | null;
  raceHalfS: number | null;
  raceFullS: number | null;
  lactateThresholdHr: number | null;
  lactateThresholdPowerW: number | null;
  enduranceScore: number | null;
  hillScore: number | null;
  hillStrength: number | null;
  hillEndurance: number | null;
}

export interface PerformanceResponse {
  from: string;
  to: string;
  granularity: Granularity;
  points: PerformancePoint[];
}

/** Seconds spent in each HR zone, summed over a bucket of activities. */
export interface IntensityPoint {
  date: string;
  zone1S: number;
  zone2S: number;
  zone3S: number;
  zone4S: number;
  zone5S: number;
}

export interface IntensityResponse {
  from: string;
  to: string;
  granularity: Granularity;
  type: string | null;
  points: IntensityPoint[];
}

// ---------------------------------------------------------------------------
// Running dynamics
// ---------------------------------------------------------------------------

/**
 * One bucket of running-form metrics, averaged over the activities in the
 * bucket. These live per-activity on the `activity` table and are only recorded
 * by dynamics-capable sensors, so coverage is partial (balance especially).
 */
export interface RunningDynamicsPoint {
  date: string;
  groundContactMs: number | null;
  balanceLeftPct: number | null;
  verticalOscillationCm: number | null;
  verticalRatioPct: number | null;
  strideLengthCm: number | null;
  avgCadence: number | null;
  avgPower: number | null;
}

export interface RunningDynamicsResponse {
  from: string;
  to: string;
  granularity: Granularity;
  type: string | null;
  points: RunningDynamicsPoint[];
}

/**
 * One activity's form metrics against its average speed, for the form-vs-pace
 * scatter. Answers "is my form at a given speed changing over time?", which the
 * bucket-averaged trend cannot (raw VO rises naturally with speed).
 */
export interface FormVsPacePoint {
  date: string;
  avgSpeedMps: number;
  verticalOscillationCm: number | null;
  verticalRatioPct: number | null;
  avgCadence: number | null;
  groundContactMs: number | null;
  distanceM: number | null;
}

export interface FormVsPaceResponse {
  from: string;
  to: string;
  type: string | null;
  points: FormVsPacePoint[];
}

// ---------------------------------------------------------------------------
// Efficiency (effort-adjusted fitness)
// ---------------------------------------------------------------------------

/**
 * One bucket of effort-adjusted running efficiency.
 * - `efficiencyFactor`: average of `(avg_speed_mps * 60) / avg_hr` — metres per
 *   minute per heartbeat. Higher = more aerobically efficient.
 * - `paceInBandS`: average pace (seconds per km) of runs whose average HR fell
 *   in the requested band, so effort is held roughly constant.
 */
export interface EfficiencyPoint {
  date: string;
  efficiencyFactor: number | null;
  paceInBandS: number | null;
  runs: number;
  runsInBand: number;
}

export interface EfficiencyResponse {
  from: string;
  to: string;
  granularity: Granularity;
  type: string | null;
  hrMin: number;
  hrMax: number;
  points: EfficiencyPoint[];
}

// ---------------------------------------------------------------------------
// Training load: monotony & strain (Foster)
// ---------------------------------------------------------------------------

/**
 * One week of training-load distribution, with rest days counted as zero load.
 * - `monotony` = mean daily load / std dev of daily load (high = every day the
 *   same intensity, a documented injury/illness risk).
 * - `strain` = weekly load × monotony.
 * Always weekly: monotony is a within-week measure.
 */
export interface TrainingLoadPoint {
  date: string;
  weeklyLoad: number;
  meanLoad: number;
  monotony: number | null;
  strain: number | null;
  days: number;
}

export interface TrainingLoadResponse {
  from: string;
  to: string;
  points: TrainingLoadPoint[];
}

// ---------------------------------------------------------------------------
// Metric catalog (cross-metric analysis)
// ---------------------------------------------------------------------------

export type MetricGroup = 'Health' | 'Sleep' | 'Recovery' | 'Training' | 'Performance' | 'Dynamics';

/**
 * Catalog of daily metrics available for overlays, comparison, and scatter
 * plots. This metadata is shared; the server holds the matching SQL for each
 * key. `format: 'duration'` means the value is seconds and should render as a
 * time. `better` notes which direction is good (for future annotations).
 */
export interface MetricMeta {
  key: string;
  label: string;
  unit: string;
  group: MetricGroup;
  format?: 'duration';
  better?: 'higher' | 'lower';
}

export const METRIC_CATALOG: readonly MetricMeta[] = [
  { key: 'resting_hr', label: 'Resting HR', unit: 'bpm', group: 'Health', better: 'lower' },
  { key: 'steps', label: 'Steps', unit: '', group: 'Health', better: 'higher' },
  { key: 'stress', label: 'Stress', unit: '', group: 'Health', better: 'lower' },
  { key: 'sleep_score', label: 'Sleep score', unit: '', group: 'Sleep', better: 'higher' },
  { key: 'sleep_hours', label: 'Sleep duration', unit: 'h', group: 'Sleep', better: 'higher' },
  { key: 'sleep_deep_hours', label: 'Deep sleep', unit: 'h', group: 'Sleep', better: 'higher' },
  { key: 'sleep_rem_hours', label: 'REM sleep', unit: 'h', group: 'Sleep', better: 'higher' },
  { key: 'hrv_nightly', label: 'HRV (nightly)', unit: 'ms', group: 'Recovery', better: 'higher' },
  { key: 'hrv_weekly', label: 'HRV (weekly)', unit: 'ms', group: 'Recovery', better: 'higher' },
  { key: 'body_battery_high', label: 'Body battery (peak)', unit: '', group: 'Recovery', better: 'higher' },
  { key: 'readiness', label: 'Training readiness', unit: '', group: 'Recovery', better: 'higher' },
  { key: 'recovery_time', label: 'Recovery time', unit: 'min', group: 'Recovery', better: 'lower' },
  { key: 'training_load_acute', label: 'Acute load (7d)', unit: '', group: 'Training' },
  { key: 'training_load_chronic', label: 'Chronic load (28d)', unit: '', group: 'Training' },
  { key: 'acwr', label: 'ACWR', unit: '', group: 'Training' },
  { key: 'vo2max', label: 'VO2max', unit: '', group: 'Performance', better: 'higher' },
  { key: 'race_5k', label: 'Predicted 5K', unit: '', group: 'Performance', format: 'duration', better: 'lower' },
  { key: 'endurance_score', label: 'Endurance score', unit: '', group: 'Performance', better: 'higher' },
  { key: 'hill_score', label: 'Hill score', unit: '', group: 'Performance', better: 'higher' },
  { key: 'fitness_age', label: 'Fitness age', unit: 'yr', group: 'Performance', better: 'lower' },
  { key: 'gct', label: 'Ground contact time', unit: 'ms', group: 'Dynamics', better: 'lower' },
  { key: 'run_balance', label: 'L/R balance (left)', unit: '%', group: 'Dynamics' },
  { key: 'vertical_oscillation', label: 'Vertical oscillation', unit: 'cm', group: 'Dynamics', better: 'lower' },
  { key: 'vertical_ratio', label: 'Vertical ratio', unit: '%', group: 'Dynamics', better: 'lower' },
  { key: 'stride_length', label: 'Stride length', unit: 'cm', group: 'Dynamics' },
  { key: 'run_cadence', label: 'Run cadence', unit: 'spm', group: 'Dynamics', better: 'higher' },
  { key: 'run_power', label: 'Run power', unit: 'W', group: 'Dynamics' },
];

export const METRIC_KEYS = METRIC_CATALOG.map((m) => m.key);

export function metricMeta(key: string): MetricMeta | undefined {
  return METRIC_CATALOG.find((m) => m.key === key);
}

/** One date bucket with a value (possibly null) for each requested metric key. */
export interface MetricPoint {
  date: string;
  values: Record<string, number | null>;
}

export interface MetricSeriesResponse {
  from: string;
  to: string;
  granularity: Granularity;
  keys: string[];
  points: MetricPoint[];
}

// ---------------------------------------------------------------------------
// Events / annotations (visualiser-owned writable state)
// ---------------------------------------------------------------------------

export const EVENT_TYPES = [
  'race',
  'injury',
  'illness',
  'medication',
  'life',
  'travel',
  'note',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface CalendarEvent {
  id: number;
  date: string;
  endDate: string | null;
  type: EventType;
  label: string;
  notes: string | null;
  createdAt: string;
}

export type EventInput = Pick<CalendarEvent, 'date' | 'type' | 'label'> &
  Partial<Pick<CalendarEvent, 'endDate' | 'notes'>>;

// ---------------------------------------------------------------------------
// Activity tags (visualiser-owned writable state)
// ---------------------------------------------------------------------------

/**
 * A user-defined label attached to individual activities — the per-activity
 * counterpart to a life `event`, which annotates a date or a date range.
 * Use a tag for something that applies to *this run* ("took antihistamine",
 * "stressful work day", "new shoes"); use an event for something that spans
 * days.
 *
 * `activityCount` is populated by the list endpoint only; create/update return
 * the tag's live count, which is 0 for a newly created tag.
 */
export interface Tag {
  id: number;
  name: string;
  /** Optional `#rrggbb` chip colour. Null renders with the default chip style. */
  colour: string | null;
  activityCount: number;
  createdAt: string;
}

export type TagInput = Pick<Tag, 'name'> & Partial<Pick<Tag, 'colour'>>;

/** The full tag set for one activity. Assigning replaces the set wholesale. */
export interface ActivityTags {
  activityId: string;
  tagIds: number[];
}

/** Hex colours offered by the tag editor. Free-form values are still accepted. */
export const TAG_COLOURS = [
  '#5fa8e6',
  '#5fce6e',
  '#e6b95f',
  '#e66a5f',
  '#b87fff',
  '#5fd6d0',
  '#8a93a0',
] as const;

// ---------------------------------------------------------------------------
// Chat persistence (visualiser-owned writable state)
// ---------------------------------------------------------------------------

export interface ChatConversation {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageRecord {
  id: number;
  conversationId: number;
  role: 'user' | 'assistant';
  content: string;
  toolCalls: { name: string; arguments: unknown }[] | null;
  /** The screen/filter hint the message was asked from, if any. */
  context: string | null;
  createdAt: string;
}

export interface ChatConversationDetail {
  conversation: ChatConversation;
  messages: ChatMessageRecord[];
}

// ---------------------------------------------------------------------------
// AI model settings (visualiser-owned writable state)
// ---------------------------------------------------------------------------

/** The AI's role: answering chat questions, or (future) generating training plans. */
export type AiRole = 'question' | 'plan';

export interface AiRoleSettings {
  /** Up to 3 candidate OpenRouter model strings the user can pick between. */
  models: [string, string, string];
  /** The currently active model — must be one of `models`. */
  selected: string;
}

export interface AiSettings {
  question: AiRoleSettings;
  plan: AiRoleSettings;
  analysis: AiRoleSettings;
}

export interface AnalyzeActivityRequest {
  question?: string;
  model?: string;
}

export interface AnalyzeActivityResponse {
  analysis: string;
  model: string;
}

export type AiSettingsInput = AiSettings;

// ---------------------------------------------------------------------------
// Training plans (visualiser-owned writable state)
// ---------------------------------------------------------------------------

export const WORKOUT_TYPES = ['easy', 'long', 'tempo', 'interval', 'race'] as const;
export type WorkoutType = (typeof WORKOUT_TYPES)[number];
export type TrainingPlanStatus = 'active' | 'ended';

export interface TrainingPlan {
  id: number;
  goalDescription: string;
  isRace: boolean;
  goalRaceDistanceM: number | null;
  goalTargetDurationS: number | null;
  startDate: string;
  endDate: string;
  daysPerWeek: number;
  status: TrainingPlanStatus;
  createdAt: string;
  endedAt: string | null;
}

export interface TrainingPlanWorkout {
  id: number;
  planId: number;
  date: string;
  title: string;
  description: string | null;
  workoutType: WorkoutType;
  targetDistanceM: number | null;
  targetDurationS: number | null;
  /** Point-estimate pace. For easy/long runs prefer the min/max range instead. */
  targetPaceSecPerKm: number | null;
  targetPaceMinSecPerKm: number | null;
  targetPaceMaxSecPerKm: number | null;
  completedAt: string | null;
  notes: string | null;
  createdAt: string;
}

export interface TrainingPlanDetail {
  plan: TrainingPlan;
  workouts: TrainingPlanWorkout[];
}

export type TrainingPlanWorkoutInput = Pick<TrainingPlanWorkout, 'date' | 'title' | 'workoutType'> &
  Partial<
    Pick<
      TrainingPlanWorkout,
      | 'description'
      | 'targetDistanceM'
      | 'targetDurationS'
      | 'targetPaceSecPerKm'
      | 'targetPaceMinSecPerKm'
      | 'targetPaceMaxSecPerKm'
      | 'notes'
    >
  >;

export type TrainingPlanWorkoutUpdate = Partial<TrainingPlanWorkoutInput> & {
  completedAt?: string | null;
};

export type TrainingPlanInput = Pick<TrainingPlan, 'goalDescription' | 'startDate' | 'endDate' | 'daysPerWeek'> &
  Partial<Pick<TrainingPlan, 'isRace' | 'goalRaceDistanceM' | 'goalTargetDurationS'>> & {
    workouts?: TrainingPlanWorkoutInput[];
  };

/** One real recent run, picked to illustrate a specific facet of recent fitness. */
export interface RepresentativeRun {
  label: 'longest' | 'fastest_effort' | 'typical' | 'most_recent';
  date: string;
  /** Garmin activity type, e.g. 'running' | 'trail_running' | 'treadmill_running' — trail pace isn't road pace. */
  type: string | null;
  distanceKm: number;
  durationS: number;
  avgPaceSecPerKm: number | null;
  elevationGainM: number | null;
}

/** Precomputed, fixed-size fitness summary fed to the plan-generation prompt — never raw daily rows. */
export interface TrainingPlanAutofill {
  /** Last 6 complete calendar weeks, zero-filled (Monday-start). */
  weeklyVolumeTrend: { weekStart: string; distanceKm: number; runCount: number }[];
  weeklyVolumeAvgKm: number | null;
  longestRecentRunKm: number | null;
  /** Up to 4 real runs from the last ~3 months, varying in length/intensity. */
  representativeRuns: RepresentativeRun[];
  vo2max: number | null;
  trainingLoad: {
    acute: number | null;
    chronic: number | null;
    acwr: number | null;
    /** ACWR values over the lookback window, oldest first — plain numbers, no risk labels. */
    acwrTrend: number[];
  };
  readinessScore: number | null;
  racePredictions: {
    race5kS: number | null;
    race10kS: number | null;
    raceHalfS: number | null;
    raceFullS: number | null;
  };
  nonRunningLoad: { group: string; count: number; distanceKm: number; durationH: number }[];
}

/** User-editable overrides of the autofilled values, sent back with the generate request. */
export interface TrainingPlanAutofillOverrides {
  weeklyVolumeAvgKm?: number | null;
  longestRecentRunKm?: number | null;
  vo2max?: number | null;
  nonRunningLoadSummary?: string | null;
  /** Free-text nuance about recent pace/effort not captured by the representative runs list. */
  paceNotes?: string | null;
}

export interface GenerateTrainingPlanRequest {
  goalDescription?: string;
  isRace: boolean;
  /** Required when isRace. */
  goalRaceDistanceM?: number | null;
  goalTargetDurationS?: number | null;
  /** Required when isRace — the plan's endDate is set to this exactly. */
  raceDate?: string;
  startDate: string;
  /** Required when !isRace — endDate is computed as startDate + durationWeeks. */
  durationWeeks?: number;
  daysPerWeek: number;
  preferredDays?: string[];
  preferredLongRunDay?: string;
  autofill?: TrainingPlanAutofillOverrides;
  /** Untracked training load the app has no visibility into (e.g. gym sessions). */
  otherTraining?: string;
  /** Holidays/travel/busy stretches not already covered by an Events entry. */
  upcomingNotes?: string;
}

/**
 * Revise an unsaved draft plan — the AI is shown the current draft plus what
 * to change and asked to revise it, not design from scratch. `endDate` is
 * passed directly (the draft already has one computed) rather than being
 * re-derived from `raceDate`/`durationWeeks` as in `GenerateTrainingPlanRequest`.
 */
export interface ReviseTrainingPlanRequest {
  goalDescription?: string;
  isRace: boolean;
  goalRaceDistanceM?: number | null;
  goalTargetDurationS?: number | null;
  startDate: string;
  endDate: string;
  daysPerWeek: number;
  preferredDays?: string[];
  preferredLongRunDay?: string;
  otherTraining?: string;
  upcomingNotes?: string;
  currentWorkouts: TrainingPlanWorkoutInput[];
  currentRationale?: string;
  instructions: string;
}

/**
 * The training plan draft returned to the client — dates/race facts are the
 * user-supplied ones (echoed back, not chosen by the model); `rationale` and
 * `workouts` are the AI's actual output. Nothing is persisted until saved.
 */
export interface GeneratedTrainingPlan {
  goalDescription: string;
  isRace: boolean;
  goalRaceDistanceM: number | null;
  goalTargetDurationS: number | null;
  startDate: string;
  endDate: string;
  daysPerWeek: number;
  rationale?: string;
  workouts: TrainingPlanWorkoutInput[];
}

// ---------------------------------------------------------------------------
// AI plan review (Phase 15A) — patches against an existing active plan, not
// a full regeneration. Notes are ephemeral: sent to the model for one review
// call and never persisted (the Events page is where a real injury/travel
// entry belongs).
// ---------------------------------------------------------------------------

export type PlanReviewScope = 'next-week' | 'remaining';
export type PlanReviewFeeling = 'good' | 'tired' | 'struggling' | 'injured';

export interface ReviewPlanRequest {
  scope: PlanReviewScope;
  feeling: PlanReviewFeeling;
  notes?: string;
}

export interface ProposedWorkoutModification {
  workoutId: number;
  patch: Partial<TrainingPlanWorkoutInput>;
  explanation: string;
}

export interface ProposedWorkoutRemoval {
  workoutId: number;
  explanation: string;
}

export type ProposedWorkoutAddition = TrainingPlanWorkoutInput & { explanation: string };

/** The AI's structured review output — nothing here is applied until the user accepts it. */
export interface ProposedPlanAdjustment {
  overallAssessment: string;
  adjustmentReason: string;
  modify: ProposedWorkoutModification[];
  remove: ProposedWorkoutRemoval[];
  add: ProposedWorkoutAddition[];
}

/** Only the changes the user checked, echoed back for a re-validated, transactional apply. */
export interface ApplyPlanReviewRequest {
  rationale: string;
  modify: ProposedWorkoutModification[];
  remove: ProposedWorkoutRemoval[];
  add: ProposedWorkoutAddition[];
}

export interface TrainingPlanRevisionChange {
  workoutId: number | null;
  before: TrainingPlanWorkout | null;
  after: TrainingPlanWorkout | null;
  explanation: string;
}

export interface TrainingPlanRevision {
  id: number;
  planId: number;
  createdAt: string;
  rationale: string;
  changes: TrainingPlanRevisionChange[];
}

// ---------------------------------------------------------------------------
// Saved routes (visualiser-owned writable state)
// ---------------------------------------------------------------------------

export interface SavedRouteWaypoint {
  lat: number;
  lng: number;
}

export interface SavedRoute {
  id: number;
  name: string;
  waypoints: SavedRouteWaypoint[];
  snap: boolean;
  totalDistanceM: number | null;
  createdAt: string;
}

export type SavedRouteInput = Pick<SavedRoute, 'name' | 'waypoints' | 'snap'> &
  Partial<Pick<SavedRoute, 'totalDistanceM'>>;

// ---------------------------------------------------------------------------
// Intraday health (per-minute / per-15-min within a day)
// ---------------------------------------------------------------------------

export interface IntradayHrPoint {
  timestampUtc: string;
  heartRate: number;
}

export interface IntradayStressPoint {
  timestampUtc: string;
  stressLevel: number | null;
}

export interface IntradayStepsPoint {
  timestampUtc: string;
  steps: number;
  activityLevel: number | null;
}

export interface IntradayRespirationPoint {
  timestampUtc: string;
  breathsPerMin: number;
}

export interface IntradayResponse {
  date: string;
  heartRate: IntradayHrPoint[];
  stress: IntradayStressPoint[];
  steps: IntradayStepsPoint[];
  respiration: IntradayRespirationPoint[];
}

// ---------------------------------------------------------------------------
// Personal records
// ---------------------------------------------------------------------------

export interface PersonalRecord {
  key: string;
  label: string;
  value: number;
  unit: string;
  format?: 'duration' | 'distance_km';
  activityId: string | null;
  date: string | null;
}

// ---------------------------------------------------------------------------
// Heatmap (derived route geometry)
// ---------------------------------------------------------------------------

export interface HeatmapEntry {
  activityId: string;
  name: string | null;
  type: string | null;
  /** Local start date, YYYY-MM-DD. */
  date: string;
  distanceM: number | null;
  /** Google encoded polyline (precision 5) of the simplified track. */
  polyline: string;
}

export interface HeatmapResponse {
  /** False while the initial geometry backfill is still running. */
  ready: boolean;
  entries: HeatmapEntry[];
}

export interface HeatmapStatus {
  total: number;
  processed: number;
  running: boolean;
}

// ---------------------------------------------------------------------------
// Route clusters (repeated route detection)
// ---------------------------------------------------------------------------

export interface RouteClusterSummary {
  id: number;
  /** Most common activity name among the efforts. */
  name: string | null;
  /** Most common activity type among the efforts. */
  type: string | null;
  count: number;
  distanceM: number | null;
  /** Local date of the latest effort, YYYY-MM-DD. */
  latestDate: string | null;
  bestPaceSecPerKm: number | null;
  /** Encoded polyline of the cluster's representative track. */
  polyline: string;
}

export interface RouteClustersResponse {
  /** False while the initial matching backfill is still running. */
  ready: boolean;
  clusters: RouteClusterSummary[];
}

export type RouteClusterStatus = HeatmapStatus;

export interface RouteClusterEffort {
  activityId: string;
  name: string | null;
  /** Local start date, YYYY-MM-DD. */
  date: string;
  distanceM: number | null;
  durationS: number | null;
  avgHr: number | null;
  avgSpeedMps: number | null;
}

export interface RouteClusterDetail {
  id: number;
  name: string | null;
  type: string | null;
  distanceM: number | null;
  polyline: string;
  efforts: RouteClusterEffort[];
}

export interface ActivityRouteClusterResponse {
  /** False while the initial matching backfill is still running. */
  ready: boolean;
  /**
   * The repeated-route cluster this activity belongs to. Null when the
   * activity has no usable track, isn't matched yet, or is the only effort
   * on its route.
   */
  cluster: RouteClusterDetail | null;
}

// ---------------------------------------------------------------------------
// EXPERIMENTAL — Fitness trend (Phase 20). Everything in this block backs the
// Experimental → Fitness Trend page only. See EXPERIMENTS.md for what each
// series is and how to remove it cleanly.
// ---------------------------------------------------------------------------

/**
 * One bucket of %HRR-normalised efficiency: metres per minute per percent of
 * heart-rate reserve, where reserve uses the same-day resting HR and a rolling
 * 12-month max observed HR. Unlike the classic EF (speed/HR), this stays
 * comparable across years as max HR falls with age.
 */
export interface HrrEfficiencyPoint {
  date: string;
  hrrEf: number | null;
  runs: number;
}

/** One activity's Garmin best-split effort (fastest 1 km or 5 km within a run). */
export interface BestEffortPoint {
  date: string;
  distanceKey: '1k' | '5k';
  seconds: number;
}

/** One run's average temperature against its pace, for the heat-sensitivity scatter. */
export interface TempPacePoint {
  date: string;
  tempC: number;
  paceSecPerKm: number;
  distanceM: number;
}

export interface FitnessTrendResponse {
  from: string;
  to: string;
  granularity: Granularity;
  type: string | null;
  hrrEf: HrrEfficiencyPoint[];
  bestEfforts: BestEffortPoint[];
  tempPace: TempPacePoint[];
}

// --- EXPERIMENTAL: Sleep timing & regularity (Phase 21) --------------------

/**
 * One night of sleep, keyed by Garmin's `sleep.date` — the **wake** date.
 *
 * Clock times are minutes relative to midnight on a night-centred axis:
 * negative is before midnight (23:40 → -20), positive is after (00:20 → 20).
 * A plain 0–1439 minute-of-day would put those two twenty minutes apart at
 * opposite ends of the scale, making every average and standard deviation
 * meaningless — which is the whole point of this page.
 *
 * The `morning*` fields are that same date's health metrics. Because the row
 * is keyed by the wake date, they are already "the morning after this night" —
 * no lag is applied.
 */
export interface SleepNightPoint {
  date: string;
  bedtimeMin: number | null;
  wakeMin: number | null;
  midpointMin: number | null;
  durationH: number | null;
  sleepScore: number | null;
  /** Std dev (minutes) of `midpointMin` over the trailing regularity window. */
  regularityMin: number | null;
  morningRestingHr: number | null;
  morningHrv: number | null;
  morningReadiness: number | null;
  morningBodyBattery: number | null;
}

/**
 * Weekday-vs-weekend sleep midpoint for one week — "social jetlag", the
 * body-clock shift caused by sleeping later at weekends. Weekend nights are
 * those waking on Saturday or Sunday. Null when a week has no nights on one
 * side of the split.
 */
export interface SocialJetlagPoint {
  weekStart: string;
  weekdayMidpointMin: number | null;
  weekendMidpointMin: number | null;
  jetlagMin: number | null;
  nights: number;
}

export interface SleepTimingResponse {
  from: string;
  to: string;
  /** Trailing window (nights) used for the rolling regularity std dev. */
  regularityWindowNights: number;
  nights: SleepNightPoint[];
  socialJetlag: SocialJetlagPoint[];
}

// --- EXPERIMENTAL: Cohort comparison (Phase 21) ---------------------------

export const COHORT_OPS = ['lt', 'lte', 'gt', 'gte'] as const;
export type CohortOp = (typeof COHORT_OPS)[number];

export const COHORT_OP_LABELS: Record<CohortOp, string> = {
  lt: 'below',
  lte: 'at or below',
  gt: 'above',
  gte: 'at or above',
};

/** Summary statistics for one side of a cohort split. */
export interface CohortStats {
  label: string;
  n: number;
  mean: number | null;
  sd: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
}

/**
 * An observational split of one metric by a condition on another — "resting HR
 * on the day after a night under 6 hours, versus every other day".
 *
 * This is a correlation over self-selected days, not an experiment: the
 * confidence interval says how precisely the difference is measured, not
 * whether the split *caused* it. The page says so too.
 */
export interface CohortResponse {
  from: string;
  to: string;
  splitKey: string;
  splitOp: CohortOp;
  splitValue: number;
  outcomeKey: string;
  /** Days to shift the outcome after the split day. 0 = same day. */
  lagDays: number;
  /** Days where both metrics were recorded (after applying the lag). */
  pairedDays: number;
  matched: CohortStats;
  other: CohortStats;
  /** `matched.mean − other.mean`, with a 95% Welch confidence interval. */
  differenceMean: number | null;
  differenceLow: number | null;
  differenceHigh: number | null;
}
