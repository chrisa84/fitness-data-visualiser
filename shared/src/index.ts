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
  verticalOscillationCm: number | null;
  verticalRatioPct: number | null;
  strideLengthCm: number | null;
  splits: ActivitySplit[];
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
  createdAt: string;
}

export interface ChatConversationDetail {
  conversation: ChatConversation;
  messages: ChatMessageRecord[];
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
