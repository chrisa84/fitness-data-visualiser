# Fitness Data Visualiser — Plan

A local web app for visualising and analysing the Garmin data mirrored by
[fitness-data-sync](https://github.com/chrisa84/fitness-data-sync)
(`garmin_sync.db`). Goal: richer views than
Garmin Connect — arbitrary date ranges, cross-metric analysis, and eventually an
AI query layer.

## Architecture

- **Node/TS backend (Fastify)** reading `garmin_sync.db` **read-only**
  (`mode=ro`). Garmin-Sync remains the sole writer; WAL mode means readers never
  block the sync.
- **React frontend** (Vite + TypeScript), TanStack Query for data fetching,
  **Apache ECharts** for charts (handles 6 years of daily points with native
  zoom/brush).
- **npm workspaces**: `server/`, `web/`, `shared/` (shared API types).

### Design rules (so we don't build into a corner)

1. Every endpoint takes arbitrary `from`/`to` — no hard-coded windows.
2. Aggregation is a server-side parameter (`day | week | month | year`)
   returning one consistent time-series shape.
3. Query layer is plain SQL in repository modules with typed results — the
   future AI layer reuses these as named tools plus a guarded read-only SQL
   tool.
4. Activity type is always a filter parameter, never baked in.
5. Units, timezone, and date maths live in `shared/`.

## Data available

Activities (summaries + splits), daily summary, sleep, HRV, stress, body
battery, heart rate, training status/load, readiness, VO2max, race predictions,
lactate threshold, and endurance/hill scores — history depends on how long the
account/device has recorded each metric. See [DATA_MODEL.md](DATA_MODEL.md) for
the per-table detail and coverage caveats.

Known gaps (fitness-data-sync features, parked): no per-second samples or GPS
tracks (so no in-activity charts or route maps yet), `activity_lap` empty, gear,
body composition.

## Phases

### Phase 0 — Walking skeleton ✅

Workspace scaffold, read-only DB connection, `/api/health` healthcheck, one
real endpoint (`/api/daily-health?from&to&granularity`), one ECharts line chart
rendering resting HR across the full history with zoom. Vitest wired up.

### Phase 1 — Activities ✅

Activity list with filtering (type, date range, search), sortable, paginated.
Activity detail page: summary stats, splits table, HR zones, training effect,
running dynamics where present. Weekly/monthly/yearly volume charts with
arbitrary ranges. Note: `activity_split` rows are Garmin splitSummaries
(interval / run-walk-detection types), not per-km splits.

### Phase 2 — Health & recovery ✅

Dashboard: sleep (duration, stages, score), HRV vs baseline band, resting HR,
stress, body battery — unified time-series component with linked date ranges.

### Phase 3 — Activity type groups ✅

Wherever an activity type filter exists, offer grouped options alongside raw
types: "all running" = running + trail_running + treadmill_running +
obstacle_run; "all cycling" = cycling + indoor_cycling; "all swimming" =
lap_swimming + open_water_swimming; "all walking" = walking + hiking. Groups
are defined in `shared/` (`ACTIVITY_GROUPS`), encoded in the filter value as
`group:<key>`, and resolved server-side into a `type IN (...)` set so list,
volume, and future intensity views all honour them. The Volume page defaults to
"all running".

### Phase 4 — Performance & training ✅

Performance page: VO2max, fitness age, training load (acute vs chronic),
ACWR with optimal/high-risk zones shaded, readiness + factor breakdown,
race-prediction trends (time-formatted axis), lactate threshold (HR + power;
the stored speed value is an unreliable unit and is omitted), endurance score,
hill score, and a colour-coded training-status timeline (day granularity only).
All date-keyed metrics come from one `/api/performance` endpoint built on a
date spine across the eight performance tables. Separate Intensity page:
weekly/monthly/yearly HR-zone stacked bars (hours or %) with the activity-type
group filter; only ~17% of activities carry zone data.

### Phase 5 — Cross-metric analysis ✅

Built on a **metric catalog**: `METRIC_CATALOG` in `shared/` lists ~20 daily
metrics; the server holds the matching SQL (`metrics.ts`) and a date-spine query
that joins only the tables the requested keys need. One `/api/metrics?keys=...`
endpoint backs all three Analysis modes:

- **Overlay** — up to 5 metrics on one chart, each normalised to its own range
  so shapes are comparable; raw values in the tooltip.
- **Compare** — one metric across two date ranges, aligned by day offset.
- **Correlate** — scatter of any X vs Y metric with an optional lag (e.g. load
  vs next-day HRV), Pearson r computed client-side.

**Events / annotations** are the visualiser's first writable state: a separate
`visualiser-events.db` (the Garmin DB stays read-only), CRUD at `/api/events`,
types race / injury / illness / medication / life / travel / note. Point events
render as marklines, ranged events (with an end date) as shaded bands, on the
Dashboard, Performance, and Analysis charts. **PR tracking**: `/api/records`
derives fastest 1K/mile/5K, longest run/ride/activity, biggest climb, and best
activity VO2max from the activity table.

### Phase 6 — AI query layer ✅

Chat endpoint (`/api/chat`) in the Fastify server using **OpenRouter**
(OpenAI-compatible) via the `openai` SDK, with tool use. Tools are the named
query functions (`get_metric_series`, `list_activities`, `get_activity_volume`,
`get_performance_series`, `get_records`, `list_events`) plus a guarded
read-only SQL tool (`run_sql`: single SELECT/WITH only, capped rows, run on the
`mode=ro` connection). The server runs the tool-use loop (max 8 steps) and
returns the answer plus which tools were used. Configure with
`OPENROUTER_API_KEY` / `OPENROUTER_MODEL` in `server/.env` (see
`server/.env.example`); without a key the Chat tab shows a setup hint and every
other feature is unaffected. Web: a Chat page with suggestions and the
conversation.

### Phase 7 — PWA & authenticated public deploy ✅

Make the app installable on a phone and reachable over the internet without
weakening the "no auth in the app" design.

- **PWA shell** — `vite-plugin-pwa` (Workbox) generates the service worker and
  injects the manifest. App shell is precached; `/api/*` uses `NetworkFirst`
  (200s only, 10s timeout) so charts stay fresh but survive a dropout. Icons in
  `web/public/icons/` (heart-rate glyph; regenerate via the Pillow script noted
  in AGENTS.md). **Caches the shell, not the data** — true offline is out of
  scope; the app still needs the server to render.
- **Mobile layout** — collapsible hamburger nav (`Layout.tsx`), single-column
  chart grid, horizontally scrollable tables, stacked chat with a horizontal
  conversation strip, larger tap targets. Charts reflow through their existing
  `ResizeObserver`, so no chart-component changes were needed.
- **Authenticated deploy** — served through Coolify behind its **own dedicated
  oauth2-proxy instance** (Google OAuth). Locked
  to a single account via an `authenticated-emails-file` (not a domain rule),
  with an isolated session cookie. Optional belt-and-braces `ALLOWED_EMAIL`
  header check in the server. The SPA handles an expired proxy session by
  reloading on a `401` (`web/src/api.ts`). Full runbook + exact env-var set:
  [`deploy/PWA-DEPLOY.md`](deploy/PWA-DEPLOY.md).

### Phase 8 — Derived efficiency & load modelling ✅

Experimental, derived analytics computed from existing columns — no new
Garmin-Sync data required. Each metric is built per-activity or per-day and
trended; everything works on activity *averages*, so it is trend-valid but
coarser than per-second analysis (cardiac drift, true grade-adjusted pace, and
long-run durability fade stay parked until sample streams are mirrored). Three
parts, delivered and committed one at a time:

1. **Efficiency page (new).** Effort-adjusted fitness from running activities.
   - **Efficiency Factor (EF)** = `avg_speed_mps / avg_hr`, averaged per bucket.
     Speed per heartbeat; a rising trend at similar effort means improving
     aerobic fitness.
   - **Pace at a fixed HR band** = average pace of runs whose `avg_hr` falls in a
     user-set band (default 145–155), per bucket. Holds effort constant so any
     pace change is fitness, not effort.
   - New `/api/efficiency` endpoint (`from`/`to`/`granularity`/`type` + `hrMin`/
     `hrMax`), repository `getEfficiencySeries`, an `Efficiency` page (type-group
     filter, HR-band inputs, two charts), and a `get_efficiency` AI tool.

2. **Form / Performance Management Chart (on the Performance page).** Reframe the
   load data already returned by `/api/performance`: plot `chronic_load`
   (Fitness) and `acute_load` (Fatigue) with **Form = chronic − acute** as a
   filled band. Positive form = fresh/tapered; deeply negative = buried. Computed
   client-side from existing fields — no backend change.

3. **Training monotony & strain (Foster).** From daily training load
   (`SUM(activity.training_load)` per day, rest days counted as 0):
   `monotony = mean(daily load) / stddev(daily load)` over each week;
   `strain = weekly load × monotony`. High monotony/strain is a documented
   injury/illness predictor and nothing else in the app surfaces it. New
   `/api/training-load` endpoint + repository (day spine so rest days count),
   weekly load bars with monotony/strain lines (on the Performance page or a small
   Load section), and a `get_training_load` AI tool.

### Phase 8 — Activity time-series charts ✅

Per-second sample streams from `activity_sample` (Garmin-Sync Phase 6b), surfaced
as in-activity charts on the Activity Detail page. Up to 2000 samples per
activity (~1 Hz; Garmin downsamples longer runs).

**Main chart** (all activity types with samples):
- X-axis: cumulative distance (km); falls back to sample index if no GPS.
- Left Y: pace (min/km, axis inverted so faster = higher) for running; speed
  (km/h) for other types.
- Right Y: heart rate (bpm).
- Altitude as a subtle area behind both series (hidden third y-axis for
  independent scaling).

**Running form chart** (running activities where GCT or cadence samples present):
- Ground contact time (left Y, ms).
- Cadence (right Y, spm).

Cross-activity HR zone distribution from samples (anchored to LT HR) is parked
until Garmin-Sync Phase 8 lands pre-aggregated derived tables — per-activity
zone breakdown from `hr_zone_1_s … hr_zone_5_s` already exists on the detail
page.

New endpoint: `GET /api/activities/:id/samples` → `ActivitySample[]`.

### Phase 9 — GPS route map with metric overlays ✅

Per-activity map on the Activity Detail page using **Leaflet** + OpenStreetMap
tiles (MIT licensed, no API key, no billing). Source data: `lat`/`lon` per
sample already returned by `/api/activities/:id/samples`.

Route rendered as consecutive coloured line segments (one per sample pair),
recoloured by a user-selected metric without reloading the map:

- **Pace** — blue (fast) → red (slow)
- **HR** — blue → red
- **L/R balance** — deviation from 50% drives colour (balanced = neutral,
  imbalanced = red)
- **Ground contact time** — low (green) → high (red)
- **Cadence** — low → high

Single map, metric selector dropdown. Hover tooltip shows metric value at that
point. Renders below the time-series chart on the Activity Detail page; hidden
when no GPS data is present.

### Phase 10 — Cross-activity HR zone views ✅

`hr_zone_1_s … hr_zone_5_s` are already stored per activity (Garmin
pre-computes them on-device). No derived tables needed.

- **Per-activity zones**: shown on the Activity Detail page (Phase 1).
- **Aggregated zone time**: Intensity page stacked bars (Phase 4) — hours or
  percentage mode, by week/month/year with activity-type filter.
- **Zone % share trend** (Phase 10): third mode on the Intensity page — five
  line series showing each zone's share of total zone time over the selected
  period. Reveals whether the zone *mix* is shifting (e.g. Z2 rising as aerobic
  base builds) without the absolute-hours noise.

### Phase 11 — Intraday health charts ✅

Garmin-Sync Phase 7 complete. Four new tables live: `intraday_heart_rate`
(per-minute), `intraday_stress` (per-~4min, NULL = rest), `intraday_steps`
(per-15min blocks with `activity_level`), `intraday_respiration` (breaths/min).
All indexed on `date`; query pattern is `WHERE date = ? ORDER BY timestamp_utc`.

New dedicated **Intraday** page (not Dashboard — that's already busy). Single
date picker (URL-synced). Charts: all-day HR line, stress line (nulls = gaps),
steps bar chart by 15-min block, respiration line. Each chart hidden when that
series has no data for the selected date. New endpoint `GET /api/intraday?date=`.

### Phase 12 — Route planner ✅

Standalone `/planner` page. Draw a running route on a map, get distance and
estimated finish time based on your actual average pace from recent runs.

**Built (Phase 12a):**
- Leaflet map, click to place waypoints, drag to adjust
- **Snap to paths** toggle — OSRM public demo (`router.project-osrm.org`),
  foot profile, no API key. Falls back to straight line on routing failure.
- Pace auto-derived from last 50 running activities; editable in `m:ss`
- Live distance + estimated time display
- Undo last waypoint, clear all
- No backend footprint — all client-side except the OSRM call

**Phase 12b — also built:**
- **Location search** — Nominatim (OSM, free, no key), 400 ms debounce,
  dropdown results, map flies to selection
- **Find my location** button — re-centre on GPS position on demand
- **Redo** — undo stack complement; restores last removed waypoint and segment
- **Reverse route** — flips waypoint order, rebuilds all segments in reverse
- **Elevation profile** — route coords batched (sampled to ≤100 pts) against
  opentopodata.org (SRTM, free, no key), 1.2 s debounce after last change;
  rendered as ECharts area chart below the map
- **Total elevation gain/loss** — computed from profile, shown in summary bar
  (↑ ascent in green, ↓ descent in red)
- **km markers** — interpolated along snapped polyline at each km boundary,
  rendered as non-interactive Leaflet labels
- **Export GPX** — serialises full snapped geometry to GPX 1.1 XML, triggers
  browser download; pure client-side, no API

**Phase 12c — Route persistence:**
- **Save / load / delete** routes via `visualiser-events.db` (same writable DB
  as events and chat). New `saved_route` table: `id`, `name`, `waypoints`
  (JSON), `snap`, `total_distance_m`, `created_at`.
- New endpoints: `GET /api/routes`, `POST /api/routes`,
  `DELETE /api/routes/:id`.
- Planner UI: "Save current" button with inline name input; list of saved
  routes below the elevation profile showing name, distance, date, Load and
  Delete. Loading re-adds waypoints in sequence (re-routing via OSRM).

No backend footprint for drawing: all map features are client-side. External
calls: OSRM (routing), Nominatim (search), opentopodata.org (elevation) — all
free, no keys, personal-use rate limits. Route persistence uses the existing
writable DB — no new infrastructure.

### Phase 13 — User-configurable AI models ✅

The model used to be a single `OPENROUTER_MODEL` env var baked in at boot. It's
now runtime-configurable from a new **Settings** page, and split into two
independent roles so a future feature can use a different (e.g. more
reasoning-heavy) model than day-to-day chat without redeploying:

- **Question AI** — powers Chat and the "Ask AI" drawer (what `OPENROUTER_MODEL`
  used to control).
- **Plan AI** — reserved for the training-plan generator (Phase 14). Stored and
  selectable today; not consumed by anything yet.

Each role holds up to 3 candidate OpenRouter model strings (freely editable)
plus one marked active. New single-row `ai_settings` table in
`visualiser-events.db` (`server/src/db.ts`), seeded on first run with all 3
slots on both roles defaulting to `deepseek/deepseek-v4-flash`,
`google/gemini-3.5-flash`, `deepseek/deepseek-v4-pro`. New
`repositories/aiSettings.ts` + `routes/aiSettings.ts`
(`GET`/`PUT /api/ai-settings`, zod-validates `selected` is one of `models`).
`routes/chat.ts` now reads the active Question AI model per-request instead of
a boot-time constant, so a change in Settings takes effect immediately with no
restart. `OPENROUTER_API_KEY`/`OPENROUTER_BASE_URL` stay env-only (secrets/
endpoint, not user-facing); `OPENROUTER_MODEL` is retired.

### Phase 14 — Training plan generator ✅

Shipped as designed below, in three slices: plain CRUD first
(`repositories/trainingPlans.ts`, `routes/trainingPlans.ts`,
`server/test/trainingPlans.test.ts`), then AI generation
(`ai/planGeneration.ts`, `repositories/trainingPlanAutofill.ts`,
`routes/trainingPlanGeneration.ts`, `server/test/planGeneration.test.ts`),
then the **Training** nav page (`web/src/pages/Training.tsx`, `/training`) —
distinct from the existing route-drawing **Planner** page. `ai_settings`'s
**Plan AI** role (Phase 13) got its first consumer here.

A form-driven, AI-generated training plan (e.g. "half marathon in 1:50 by
2026-10-01, running 4 days a week") that's previewed, editable, and saved as
a checklist the user ticks off over time, with history of past (ended) plans
kept visible.

**Data model:**
```
training_plan (id, goal_description, is_race, goal_race_distance_m,
               goal_target_duration_s, start_date, end_date, days_per_week,
               status['active'|'ended'], created_at, ended_at)
training_plan_workout (id, plan_id, date, title, description, workout_type,
                        target_distance_m, target_duration_s,
                        target_pace_sec_per_km, completed_at, notes, created_at)
```
Ending a plan just flips status — history stays queryable. Ticking/editing/
deleting a workout is a plain row update/delete, no AI involved. Deliberately
no per-weekday input (no reason to assume weekends are off) — just a "days
per week" frequency; the AI decides which specific days make sense for the
workout mix.

**Horizon cap:** 12 weeks (84 days) max per plan, enforced at the intake form
(date picker) and again at the API (zod refine on the date range) as defense
in depth. Matches realistic usage and keeps every `propose_plan` call small —
a few dozen workout rows, not hundreds. Longer-running adaptation is Phase 15
below, not a one-shot year-long generation.

**Only one active plan at a time:** creating a new plan is rejected (409)
while one is already `active` — the user must explicitly End the current
plan first. A plain existence check in the repository before insert; no DB
constraint needed for a single-user app, but the guard lives in the
repository layer so it holds regardless of caller.

**Race vs. general-fitness goals:** no separate "is this a race?" form
toggle — the free-text goal stays the only intake field, and the model
itself decides via its `propose_plan` output whether `isRace` /
`goalRaceDistanceM` / `goalTargetDurationS` apply (null/false for something
like "build a base"). Taper only kicks in when `isRace` is true; a
general-fitness plan still gets progressive volume/intensity structuring
with cutback weeks, it just skips taper and precise goal-pace math — a plan
without a race target isn't pointless, it just optimises for a different
thing. The stored structured fields, when present, are what let a future
page compare "goal pace vs. current PR pace" without re-parsing prose.

**Only prescribed training days get a row** — row count per week equals
`days_per_week` exactly (4 rows/week for a 4-day plan, not 7). A date with no
row is implicitly a rest day: nothing stored, nothing to reconcile against
other activities. The AI still picks which specific dates the sessions land
on; it never needs to write "rest" — absence of a row already means that.
This deliberately excludes cross-training prescriptions too (e.g. "Wednesday:
30 min bike") — reconciling a prescribed non-running session against a real
logged activity is materially harder than a running workout (pace/distance
targets don't map cleanly onto a bike ride) and drags in accounting for
activities outside the plan's own scope. Not a v1 problem; could become an
explicit future feature if wanted.

**`workout_type` is a shared enum, not a free string:** `easy | long | tempo
| interval | race`, added to `shared/src/index.ts` alongside `EVENT_TYPES`.
Two reasons it exists at all: consistent colour/icon rendering on the
checklist page, and it's what makes intensity-split analysis (the whole point
of feeding the model autofilled fitness data) actually computable later —
free-text labels drift ("Easy Run" vs "recovery jog") and can't be
aggregated. Locked down the same way `EVENT_TYPES` locks the events route: a
`z.enum([...])` in the `propose_plan` tool schema, so a bad value fails the
tool call structurally instead of free-texting past validation.

**Intake form:** start date, end date (capped at 12 weeks out), "what are you
training for" (free text with example chips: "complete a marathon", "half
marathon in 1:50", "just build a base"), days/week, and two optional
free-text fields, both informational only — fed straight into the prompt,
never scheduled/tracked/reconciled against activities unlike the running
workouts themselves:
- "anything else you're currently training that's not logged here?" — for
  load the app has no way to see (untracked gym/swim sessions etc.).
- "anything coming up in this window we should know about?" — holidays,
  travel, a busy work stretch. `event` rows (`race`/`injury`/`illness`/
  `travel`/`life`/`note`, `date`/`endDate`, no restriction to the past —
  `eventBody` in `routes/analysis.ts` only requires `endDate >= date`) that
  already overlap the plan's date range are auto-pulled in for free
  alongside this, read-only; the free-text field is for anything not already
  logged there, or too fuzzy/recurring to be worth a formal Event row (e.g.
  "always tight on weekday mornings"). Not either/or — the Events pull needs
  zero user effort for whatever's already logged, the free text catches the
  rest without forcing a full Event entry for a one-off plan note.

Rather than manually asking about current weekly mileage, longest recent
run, recent race pace, etc. — all of that is derivable from existing data —
the form has an **"autofill from your data"** button that queries it via
existing repository functions (recent volume, records, performance) and
prefills those fields, editable before generating.

**Feeding the model enough to judge feasibility and prescribe paces/zones —
without overwhelming context or timing out:** the whole point of the
autofilled block (recent weekly volume trend, longest recent run, most
relevant recent race/PR pace for the goal distance, current VO2max/training
status from the Performance repository, **plus recent non-running activity
load** — e.g. cycling/strength sessions already logged, same repository
functions filtered to other activity types) is that it's exactly what the
model needs to (a) sanity-check whether the goal is realistic in the time
available and flag it if not, and (b) derive concrete per-workout targets —
pace bands, long-run length progression, easy/tempo/interval intensity split,
and recovery placement relative to other training load — grounded in the
user's actual current fitness rather than generic templates. This is a small,
fixed-size summary (a handful of numbers), not raw daily rows, so it stays
cheap and fast regardless of how much history exists. None of this autofill
pre-pass costs AI tokens — it's plain repository queries, same as today's
Volume/Records/Performance pages; the model only sees the small precomputed
summary at actual generation time.

**Reuse the existing Events feature for holidays / injury / time
constraints — don't build a second one.** `EVENT_TYPES` already covers
`injury | illness | medication | life | travel | note` with a `date`/
`endDate` range (`shared/src/index.ts`, backed by the `event` table). The
generator queries events overlapping the plan's date range: past `injury`/
`illness` feed the feasibility check (don't assume full fitness right after
one), and `travel`/`life` events falling inside the plan window tell the AI
which dates to schedule around (no long run during a logged holiday week).
Shown as **read-only** context in the intake form with a link to the Events
page — Events is already the source of truth with its own edit UI, so the
plan form doesn't duplicate it. If nothing's logged for the range, a small
nudge to add one is shown instead.

`ai/planGeneration.ts` dispatches through `ai/tools.ts`'s `executeTool` in a
**sibling** loop to `ai/chat.ts`'s `runChat` (that function stays generic for
ordinary chat, untouched), but only offers a small plan-relevant subset of
`TOOL_DEFINITIONS` (`get_records`, `get_performance_series`,
`get_activity_volume`, `list_events`) rather than the full chat toolset —
the autofill summary already covers what plan design needs, and a smaller
per-request tool/schema payload is meaningfully more reliable across models,
especially cheaper/faster ones. `tool_choice` is `'auto'` on every step
except the final allowed one, where the tool list narrows to just
`propose_plan` and `tool_choice` becomes `'required'` — **not** the
named-function form (`{type:'function', function:{name:'propose_plan'}}`),
which needs each provider/aggregator to correctly translate "force this one
specific function," a known weak spot for non-OpenAI-native backends
(Gemini, DeepSeek, etc. via OpenRouter). `'required'` with a single-entry
tool list gets the same guarantee through the far more universally
supported plain string form. Accepting an early `propose_plan` call (before
the forced step) short-circuits the loop immediately. The arguments are
zod-validated against `schemas/trainingPlan.ts` (sharing the same
`workout_type` enum and workout shape as the plain-CRUD body) — a
bad value throws `PlanGenerationError` rather than free-texting past
validation. (Superseded by Phase 14.1 below: the AI's own output schema
shrank considerably once dates/race facts became user-supplied.) A malformed/degraded provider response (missing `choices`
entirely) is guarded against rather than crashing on an unchecked index.
The route's catch block logs and returns a clean `502` JSON body for *any*
caught error, not just `PlanGenerationError` — a genuine OpenRouter/network
failure comes back as `error: 'ai_error'` with the real message, matching
`chat.ts`'s equivalent catch-all, instead of an unlogged re-thrown exception.

The system prompt carries explicit coaching guidance beyond "design a plan":
taper only when `isRace`, cap hard sessions to one tempo + one interval per
week, flag an infeasible goal in `rationale` and still propose the safest
reasonable version rather than refusing, and ground `rationale` in the
actual autofill numbers (not generic encouragement) so the user can see
*why* the plan looks the way it does. This exists specifically to help
weaker/cheaper models produce a sane, explainable plan.

**Flow:** fill form (optionally autofill) → Generate → preview as an editable
table (nothing saved yet) → adjust inputs and regenerate, or edit rows
directly, or Save → `POST /api/training-plans` persists plan + workouts. The
Training page shows the active plan as a checklist (tick complete / edit /
delete per row) plus a list of past ended plans for history.

### Phase 14.1 — Training plan generator rethink ✅

Live-testing Phase 14 on the deployed instance surfaced real bugs and UX
gaps in the generator's inputs and outputs (a second independent review
cross-checked the same root causes). This phase fixed them without a
wholesale redesign — see `AGENTS.md`'s gotchas for the mechanics; this is
the "why."

**Race date/distance/duration are now explicit user-supplied facts,
reversing Phase 14's original call.** Phase 14 deliberately kept `isRace`
etc. AI-inferred from free text, reasoning that a form toggle was
unnecessary ceremony. In practice this meant the model had to guess both
whether there was a race and exactly when it was, and nothing bounded a
workout's date to the plan's own window — a live-generated plan put its
`race` row a day *after* the stated `endDate`. The intake form now asks
directly: race toggle → distance/date/optional target time, or (for a
general-fitness goal) a plan-length-in-weeks field instead of a fake end
date. `routes/trainingPlanGeneration.ts` computes `endDate` deterministically
(race day itself, or `startDate + durationWeeks`) before calling
`generatePlan` — never something the model chooses. This also shrank what
the model has to get right: `propose_plan`'s required output dropped from
the full plan (goal/dates/race fields/workouts) to just `{ rationale,
workouts[] }`, continuing this project's pattern of treating "required
structured-output surface area" as the thing that breaks across weaker
models, not something to keep adding to freely.

**Deterministic checks after a valid `propose_plan` parse**, not just
prompt guidance: every workout date within `[startDate, endDate]`; when
racing, exactly one `race` row on `endDate` with no `long`/`tempo`/
`interval` session in the final 2 days before it. Deliberately narrow —
broader coaching rules (weekly progression sanity, hard-day spacing beyond
the race week, session-frequency matching) stay prompt-only, since those
are judgment calls that could false-positive on a legitimate plan, unlike
the two checks above which are unambiguous. No repair/retry pass on
failure — a violation is a `502`, same as any other generation failure; the
user clicks Regenerate.

**Autofill data got three fixes, all confirmed bugs, not redesign
opinions:**
- Weekly volume averaged the *last returned* bucket from a plain
  `GROUP BY`, which is (a) almost always the current in-progress week
  (since `to` defaults to today) and (b) silently skips weeks with zero
  runs instead of counting them as zero, inflating the average either way.
  Replaced with a real zero-filled calendar-week spine (6 complete
  Monday-start weeks, via a SQL `VALUES` spine).
- "Relevant pace" concatenated *every* all-time personal record —
  including `longest_ride`, `biggest_climb`, `highest_vo2max` — into one
  string, which is where the original "wtf is this" raw-number-dump bug
  came from even after the formatting fix. Replaced with `representativeRuns`:
  up to 4 real runs from the last ~90 days (longest / fastest effort /
  typical / most recent), which is what "a selection of runs of varying
  intensity and length" actually means, versus all-time bests or a single
  algorithmic prediction.
- ACWR got a fixed "sweet spot / high risk" label in an earlier draft of
  this rework; dropped before shipping as false precision — it now surfaces
  as a plain trend (values over the lookback window), no editorial banding.

The fitness-context card is no longer gated behind an "Autofill" button —
autofill is plain SQL (zero AI tokens) so it loads automatically on page
mount; the button is now "Refresh from Garmin." Structured values (volume
trend, representative runs, load trend) are re-fetched fresh by the route
at generate time regardless of what's in the request body — only a small
set of scalars (`weeklyVolumeAvgKm`, `longestRecentRunKm`, `vo2max`) plus
two free-text nuance fields (`nonRunningLoadSummary`, `paceNotes`) round-trip
through `TrainingPlanAutofillOverrides` as user-editable overrides, avoiding
the class of bug where a mangled/oversized free-text string broke
validation (hit earlier this session with `relevantPace`).

**Workout output:** `targetPaceMinSecPerKm`/`targetPaceMaxSecPerKm` added
alongside the existing point-estimate `targetPaceSecPerKm` (new nullable
columns on `training_plan_workout`, migrated via the same `PRAGMA
table_info` + `ALTER TABLE` pattern as `chat_message.context`) — a single
pace doesn't describe an easy/long run realistically. Tempo/interval
workouts now require a real `description` (zod-enforced minimum length) —
a bare distance isn't enough for a hard session. The Training page surfaces
pace/duration/description in all three workout tables (draft preview,
active-plan checklist, history), which the schema always supported but the
UI silently dropped.

**Preferred training days** (optional, soft prompt guidance, not a hard
schema constraint) were added since the intake form now asks for enough
structure that "which days" became a reasonable next question — deliberately
kept advisory rather than validated, to avoid reintroducing the reliability
risk of over-constraining the model.

**Explicitly not built this round** (considered, deferred): fully
structured warm-up/repetition/recovery step objects (pace ranges + a
required description cover the immediate complaint; a full structured
workout shape is a bigger schema/UI change for later if the simpler version
still feels limiting), automatic repair/regeneration on a failed
deterministic check, comprehensive progression validation, a full
availability calendar (preferred days is the bounded version that shipped),
and adaptive planned-vs-actual review (still Phase 15, below).

**Follow-up correctness pass**, caught by a second independent review plus
live testing right after the above shipped: the `durationWeeks` end-date
math was off by one (`startDate + durationWeeks*7`, not `*7 - 1` — see
`computeEndDate` in `routes/trainingPlanGeneration.ts`); the autofill
overrides sync effect re-fired on every background refetch, not just the
explicit Refresh button, clobbering in-progress edits; the pace-range
`min`/`max` field descriptions were backwards (numerically smaller = faster,
not "slow end"), producing displayed ranges like "5:30–5:00/km" — fixed at
both the prompt-description source and defensively in
`formatPaceFromSecPerKm` (always renders faster→slower regardless of
argument order); `representativeRuns` didn't carry activity type/elevation,
so a trail effort's pace could get treated as flat-road pace; workout
`notes` were stored but never rendered in any of the three workout tables
despite being agreed scope; `trainingPlanBaseBody.goalDescription`'s
`min(1)` requirement was never relaxed alongside making the field optional
on the generate side, so saving a plan with no goal text 400'd; and several
`minWidth`-pixel textareas didn't respect narrow viewports.

**Full workout editing on the active plan.** The checklist previously only
offered tick/delete — never built as part of Phase 14, not a regression.
`WorkoutRow` now has an Edit button that expands the row into an in-place
card (all fields: date/type/title/description/distance/duration/pace
point+range/notes, Save/Cancel) — not a modal, since this app has no modal
infrastructure anywhere and building one would be disproportionate to the
ask. Backend already supported every field via the existing `PATCH
/api/training-plan-workouts/:id`; this was purely a UI gap. Two related but
explicitly *separate* future features, not built now: revising an unsaved
draft with AI (regenerate one workout/week or the whole proposal) and
Phase 15's adaptive review of an already-saved, already-lived-in plan
(below) — manual full-edit is foundational for both and isn't wasted
effort either way.

**Server-side invariants on workout updates.** `updateWorkout`
(`repositories/trainingPlans.ts`) previously merged `{...existing,
...patch}` and wrote it straight to the DB with no validation at all — not
even a window-bound check. It now validates the *merged* result (not the
raw patch, which can't be checked in isolation — a patch touching only
`title` still needs the pre-existing `workoutType`/`description` checked
together) via `assertMergedWorkoutValid`, throwing `WorkoutValidationError`
(→ `400`) for: a date outside the plan window, an inverted pace range
(`min > max`), or a tempo/interval workout without a meaningful
description. The same tempo/interval-description and pace-order checks are
also now enforced at the zod level for the create paths
(`trainingPlanWorkoutBody`), where they can be expressed declaratively.

**Revise draft.** The unsaved draft preview previously only offered a
single-field-per-row hand edit or "Regenerate" (which discards the whole
draft and starts over). `POST /api/training-plans/revise`
(`routes/trainingPlanGeneration.ts`) adds a targeted middle ground: the
user describes a change in free text ("make the long run shorter in week
1"), and the model edits the existing draft rather than designing from
scratch. This deliberately reuses the entire existing generation pipeline
— `generatePlan()` (`ai/planGeneration.ts`) gained an optional `revision`
field carrying the current draft's workouts/rationale plus the
instructions; `systemPrompt()` swaps its opening framing to "you are
editing this, not designing a fresh one" and lists the current draft
compactly, but every hard fact and coaching rule below that (race day
placement, window bounds, hard-session caps, pace-range guidance) applies
unchanged, and the same deterministic post-generation checks run on the
result — no parallel validation path, no new reliability surface. A
revision has no `goalDescription`/`raceDate`/`durationWeeks` of its own
(the draft being revised already has concrete `startDate`/`endDate` from
the original generate call — nothing to re-derive); the web client
explicitly keeps its own `goalDescription` after a revise response rather
than trusting the route's placeholder empty string.

Deliberately separate from Phase 15 below — this operates on an *unsaved*
draft with no usage history, so it has no dependency on the plan having
been lived in yet, unlike Phase 15's planned-vs-actual comparison.

### Phase 15 — Adaptive plan check-in (design — future, depends on Phase 14)

Training plans go stale as fitness changes over 12 weeks. Rather than
regenerating anything automatically, give the user a manual review action:

- **Manual trigger only** — a button on the Training page ("ask AI to review
  my plan"). No scheduled/background AI calls; matches how the rest of the
  app only calls the AI on request.
- Feeds the model the plan's remaining (incomplete, future-dated) workouts
  plus a fresh autofill-style summary of what's actually happened since the
  plan started (ticked-off vs. skipped workouts, actual recent volume/pace
  vs. what was prescribed) — a "planned vs. actual" delta, same
  small-fixed-size philosophy as the initial generation.
- A new `propose_plan_adjustment` tool call (zod-validated) returns a set of
  `{ workoutId, action: 'modify' | 'remove', ...fields }` for **future**
  workouts only — the schema should make it structurally impossible to touch
  a completed or past-dated workout, protecting history.
- Shown as a diff, same preview-before-save pattern as initial generation;
  the user accepts individual lines or all/nothing — nothing is ever
  auto-applied.
- Deliberately its own phase, after Phase 14's core ships and is usable
  standalone.

### Parked (requires Garmin-Sync work first)

Gear/shoe mileage, body composition.
