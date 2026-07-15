import type {
  ActivityDetail,
  ActivityListResponse,
  ActivityRouteClusterResponse,
  ActivitySample,
  ActivitySortKey,
  ActivityTypeCount,
  AiSettings,
  AiSettingsInput,
  AnalyzeActivityRequest,
  AnalyzeActivityResponse,
  CalendarEvent,
  DailyHealthResponse,
  EventInput,
  Granularity,
  ChatConversation,
  ChatConversationDetail,
  EfficiencyResponse,
  FitnessTrendResponse,
  FormVsPaceResponse,
  IntensityResponse,
  IntradayResponse,
  MetricSeriesResponse,
  PerformanceResponse,
  HeatmapResponse,
  HeatmapStatus,
  PersonalRecord,
  RouteClusterDetail,
  RouteClustersResponse,
  RouteClusterStatus,
  RunningDynamicsResponse,
  SavedRoute,
  SavedRouteInput,
  TrainingLoadResponse,
  TrainingPlan,
  TrainingPlanAutofill,
  TrainingPlanDetail,
  TrainingPlanInput,
  TrainingPlanStatus,
  TrainingPlanWorkout,
  TrainingPlanWorkoutInput,
  TrainingPlanWorkoutUpdate,
  GenerateTrainingPlanRequest,
  GeneratedTrainingPlan,
  ReviseTrainingPlanRequest,
  ReviewPlanRequest,
  ProposedPlanAdjustment,
  ApplyPlanReviewRequest,
  TrainingPlanRevision,
  VolumeResponse,
} from '@fitness/shared';

/**
 * When the app is deployed behind an edge auth proxy, an expired session makes
 * the proxy answer API calls with 401 (we send `Accept: application/json` so it
 * returns a status code rather than an HTML login redirect). We re-authenticate
 * by triggering a top-level *network* navigation, letting whatever proxy sits at
 * the edge run its own login flow. The app stays deliberately decoupled from the
 * auth layer (AGENTS.md: "Auth is at the edge, never in the app") — it assumes
 * no proxy, no provider, and no login path. Running locally (no proxy) this
 * branch never fires.
 *
 * Why NOT a plain `window.location.reload()`: in the installed PWA a Workbox
 * service worker fronts every navigation and serves the *precached* app shell,
 * so a reload never reaches the proxy — it reboots the cached shell, which 401s
 * again and reloads again, forever (the phone gets stuck in a tight loop with no
 * window to clear site data). So we first unregister the service worker; with
 * nothing intercepting, the reload becomes a real network navigation the edge
 * proxy can redirect to its login. The SW re-registers on the next clean load.
 *
 * Loop guard: we stamp the attempt time in sessionStorage. If we come back here
 * still 401ing within the cooldown, re-auth did NOT establish a session — so
 * instead of reloading again we show a full-screen, tappable "sign in" overlay.
 * That hands control back to the user rather than trapping them in a loop.
 *
 * A 403 is deliberately NOT handled here: it means authenticated-but-not-
 * authorised (the optional single-account app gate), and reloading would loop.
 * That surfaces as an ordinary error instead.
 */
const AUTH_ATTEMPT_KEY = 'fdv:authAttemptAt';
const AUTH_ATTEMPT_COOLDOWN_MS = 20_000;
let handlingAuthExpired = false;

function showSignInOverlay(): void {
  if (typeof document === 'undefined' || document.getElementById('fdv-auth-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'fdv-auth-overlay';
  overlay.setAttribute(
    'style',
    'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;gap:20px;padding:24px;text-align:center;' +
      'background:#14171c;color:#e6e9ef;font-family:system-ui,-apple-system,sans-serif;',
  );
  const msg = document.createElement('p');
  msg.textContent = 'Your session has expired.';
  msg.setAttribute('style', 'margin:0;font-size:18px;');
  const btn = document.createElement('button');
  btn.textContent = 'Sign in again';
  btn.setAttribute(
    'style',
    'padding:14px 28px;border:0;border-radius:10px;background:#e05a47;color:#fff;' +
      'font-size:17px;font-weight:600;cursor:pointer;',
  );
  // The SW was already unregistered on the previous attempt, so this reload is a
  // real network navigation the edge proxy can redirect to its login.
  btn.addEventListener('click', () => window.location.reload());
  overlay.append(msg, btn);
  document.body.append(overlay);
}

async function reauthenticate(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    // best effort — reload regardless.
  }
  window.location.reload();
}

function handleAuthExpired(): never {
  if (handlingAuthExpired) throw new Error('Session expired — signing in again.');
  handlingAuthExpired = true;

  let lastAttempt = 0;
  try {
    lastAttempt = Number(sessionStorage.getItem(AUTH_ATTEMPT_KEY)) || 0;
  } catch {
    // sessionStorage can throw in locked-down webviews — fall through to reload.
  }

  // Came back still 401ing right after a re-auth attempt → it didn't work.
  // Stop looping; give the user a button they can actually tap.
  if (lastAttempt && Date.now() - lastAttempt < AUTH_ATTEMPT_COOLDOWN_MS) {
    showSignInOverlay();
    throw new Error('Session expired — please sign in.');
  }

  try {
    sessionStorage.setItem(AUTH_ATTEMPT_KEY, String(Date.now()));
  } catch {
    // ignore — worst case we can't throttle and fall back to the overlay path.
  }
  void reauthenticate();
  throw new Error('Session expired — signing in again.');
}

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) handleAuthExpired();
  return res;
}

async function getJson<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  const res = await apiFetch(qs ? `${path}?${qs}` : path);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

export function fetchDailyHealth(params: { from?: string; to?: string; granularity: Granularity }) {
  return getJson<DailyHealthResponse>('/api/daily-health', params);
}

export function fetchActivities(params: {
  from?: string;
  to?: string;
  type?: string;
  q?: string;
  minKm?: number;
  maxKm?: number;
  sort?: ActivitySortKey;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}) {
  return getJson<ActivityListResponse>('/api/activities', params);
}

export function analyzeActivity(id: string, input: AnalyzeActivityRequest) {
  return sendJson<AnalyzeActivityResponse>('POST', `/api/activities/${id}/analyze`, input);
}

export function fetchActivityTypes() {
  return getJson<ActivityTypeCount[]>('/api/activity-types');
}

export function fetchActivity(id: string) {
  return getJson<ActivityDetail>(`/api/activities/${id}`);
}

export function fetchActivitySamples(id: string) {
  return getJson<ActivitySample[]>(`/api/activities/${id}/samples`);
}

export function fetchIntraday(date: string) {
  return getJson<IntradayResponse>('/api/intraday', { date });
}

export function fetchVolume(params: {
  from?: string;
  to?: string;
  granularity?: Granularity;
  type?: string;
}) {
  return getJson<VolumeResponse>('/api/activity-volume', params);
}

export function fetchPerformance(params: { from?: string; to?: string; granularity?: Granularity }) {
  return getJson<PerformanceResponse>('/api/performance', params);
}

export function fetchIntensity(params: {
  from?: string;
  to?: string;
  granularity?: Granularity;
  type?: string;
}) {
  return getJson<IntensityResponse>('/api/intensity-distribution', params);
}

export function fetchMetrics(params: {
  keys: string[];
  from?: string;
  to?: string;
  granularity?: Granularity;
}) {
  return getJson<MetricSeriesResponse>('/api/metrics', {
    keys: params.keys.join(','),
    from: params.from,
    to: params.to,
    granularity: params.granularity,
  });
}

export function fetchRunningDynamics(params: {
  from?: string;
  to?: string;
  granularity?: Granularity;
  type?: string;
}) {
  return getJson<RunningDynamicsResponse>('/api/running-dynamics', params);
}

export function fetchFormVsPace(params: { from?: string; to?: string; type?: string }) {
  return getJson<FormVsPaceResponse>('/api/form-vs-pace', params);
}

export function fetchEfficiency(params: {
  from?: string;
  to?: string;
  granularity?: Granularity;
  type?: string;
  hrMin?: number;
  hrMax?: number;
}) {
  return getJson<EfficiencyResponse>('/api/efficiency', params);
}

// EXPERIMENTAL — backs the Fitness Trend page only. See EXPERIMENTS.md.
export function fetchFitnessTrend(params: {
  from?: string;
  to?: string;
  granularity?: Granularity;
  type?: string;
}) {
  return getJson<FitnessTrendResponse>('/api/experimental/fitness-trend', params);
}

export function fetchTrainingLoad(params: { from?: string; to?: string }) {
  return getJson<TrainingLoadResponse>('/api/training-load', params);
}

export function fetchRecords() {
  return getJson<PersonalRecord[]>('/api/records');
}

export function fetchHeatmap() {
  return getJson<HeatmapResponse>('/api/heatmap');
}

export function fetchHeatmapStatus() {
  return getJson<HeatmapStatus>('/api/heatmap/status');
}

export function fetchRouteClusters() {
  return getJson<RouteClustersResponse>('/api/route-clusters');
}

export function fetchRouteClusterStatus() {
  return getJson<RouteClusterStatus>('/api/route-clusters/status');
}

export function fetchRouteClusterDetail(id: number) {
  return getJson<RouteClusterDetail>(`/api/route-clusters/${id}`);
}

export function fetchActivityRouteCluster(id: string) {
  return getJson<ActivityRouteClusterResponse>(`/api/activities/${id}/route-cluster`);
}

export function fetchEvents(params?: { from?: string; to?: string }) {
  return getJson<CalendarEvent[]>('/api/events', params);
}

async function sendJson<T>(method: string, path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.message ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

export function fetchRoutes() {
  return getJson<SavedRoute[]>('/api/routes');
}

export function createSavedRoute(input: SavedRouteInput) {
  return sendJson<SavedRoute>('POST', '/api/routes', input);
}

export async function deleteSavedRoute(id: number): Promise<void> {
  const res = await apiFetch(`/api/routes/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete route (${res.status})`);
}

export function createEvent(input: EventInput) {
  return sendJson<CalendarEvent>('POST', '/api/events', input);
}

export function updateEvent(id: number, input: EventInput) {
  return sendJson<CalendarEvent>('PATCH', `/api/events/${id}`, input);
}

export async function deleteEvent(id: number): Promise<void> {
  const res = await apiFetch(`/api/events/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete event (${res.status})`);
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}
export interface ChatStatus {
  enabled: boolean;
  model: string;
}
export interface ChatReply {
  reply: string;
  toolCalls: { name: string; arguments: unknown }[];
  conversationId: number;
}

export function fetchChatStatus() {
  return getJson<ChatStatus>('/api/chat/status');
}

export function fetchAiSettings() {
  return getJson<AiSettings>('/api/ai-settings');
}

export function updateAiSettings(input: AiSettingsInput) {
  return sendJson<AiSettings>('PUT', '/api/ai-settings', input);
}

export function sendChat(messages: ChatTurn[], conversationId?: number, context?: string) {
  return sendJson<ChatReply>('POST', '/api/chat', { messages, conversationId, context });
}

export function fetchConversations() {
  return getJson<ChatConversation[]>('/api/chat/conversations');
}

export function fetchConversation(id: number) {
  return getJson<ChatConversationDetail>(`/api/chat/conversations/${id}`);
}

export async function deleteConversation(id: number): Promise<void> {
  const res = await apiFetch(`/api/chat/conversations/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete conversation (${res.status})`);
}

export function fetchTrainingPlans(status?: TrainingPlanStatus) {
  return getJson<TrainingPlan[]>('/api/training-plans', { status });
}

/** Null means no active plan (a 404) — not distinguished from a real error, so check status first. */
export async function fetchActiveTrainingPlan(): Promise<TrainingPlanDetail | null> {
  const res = await apiFetch('/api/training-plans/active');
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

export function fetchTrainingPlan(id: number) {
  return getJson<TrainingPlanDetail>(`/api/training-plans/${id}`);
}

export function createTrainingPlan(input: TrainingPlanInput) {
  return sendJson<TrainingPlanDetail>('POST', '/api/training-plans', input);
}

export function endTrainingPlan(id: number) {
  return sendJson<TrainingPlan>('POST', `/api/training-plans/${id}/end`, {});
}

export async function deleteTrainingPlan(id: number): Promise<void> {
  const res = await apiFetch(`/api/training-plans/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete training plan (${res.status})`);
}

export function createTrainingPlanWorkout(planId: number, input: TrainingPlanWorkoutInput) {
  return sendJson<TrainingPlanWorkout>('POST', `/api/training-plans/${planId}/workouts`, input);
}

export function updateTrainingPlanWorkout(id: number, input: TrainingPlanWorkoutUpdate) {
  return sendJson<TrainingPlanWorkout>('PATCH', `/api/training-plan-workouts/${id}`, input);
}

export async function deleteTrainingPlanWorkout(id: number): Promise<void> {
  const res = await apiFetch(`/api/training-plan-workouts/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete workout (${res.status})`);
}

export function fetchTrainingPlanAutofill() {
  return getJson<TrainingPlanAutofill>('/api/training-plans/autofill');
}

export function generateTrainingPlan(input: GenerateTrainingPlanRequest) {
  return sendJson<GeneratedTrainingPlan>('POST', '/api/training-plans/generate', input);
}

export function reviseTrainingPlan(input: ReviseTrainingPlanRequest) {
  return sendJson<GeneratedTrainingPlan>('POST', '/api/training-plans/revise', input);
}

export function reviewTrainingPlan(planId: number, input: ReviewPlanRequest) {
  return sendJson<ProposedPlanAdjustment>('POST', `/api/training-plans/${planId}/review`, input);
}

export function applyPlanReview(planId: number, input: ApplyPlanReviewRequest) {
  return sendJson<TrainingPlanRevision>('POST', `/api/training-plans/${planId}/review/apply`, input);
}
