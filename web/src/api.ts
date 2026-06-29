import type {
  ActivityDetail,
  ActivityListResponse,
  ActivitySample,
  ActivitySortKey,
  ActivityTypeCount,
  CalendarEvent,
  DailyHealthResponse,
  EventInput,
  Granularity,
  ChatConversation,
  ChatConversationDetail,
  EfficiencyResponse,
  IntensityResponse,
  MetricSeriesResponse,
  PerformanceResponse,
  PersonalRecord,
  RunningDynamicsResponse,
  TrainingLoadResponse,
  VolumeResponse,
} from '@fitness/shared';

/**
 * When the app is deployed behind oauth2-proxy, an expired session makes the
 * proxy answer API calls with 401 (we send `Accept: application/json` so it
 * returns a status code rather than an HTML login redirect). A full-page reload
 * re-enters the proxy's login flow via a top-level navigation, which lands on
 * Google and back. Running locally (no proxy) this branch never fires.
 *
 * A 403 is deliberately NOT handled here: it means authenticated-but-not-
 * authorised (the optional single-account app gate), and reloading would loop.
 * That surfaces as an ordinary error instead.
 */
let reloadingForAuth = false;
function handleAuthExpired(): never {
  if (!reloadingForAuth) {
    reloadingForAuth = true;
    window.location.reload();
  }
  throw new Error('Session expired — signing in again.');
}

async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
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
  sort?: ActivitySortKey;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}) {
  return getJson<ActivityListResponse>('/api/activities', params);
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

export function fetchTrainingLoad(params: { from?: string; to?: string }) {
  return getJson<TrainingLoadResponse>('/api/training-load', params);
}

export function fetchRecords() {
  return getJson<PersonalRecord[]>('/api/records');
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
