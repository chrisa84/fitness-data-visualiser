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

### Phase 7 — Derived efficiency & load modelling ✅

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

### Phase 8 — Activity time-series charts 🚧

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

### Phase 9 — GPS route map with metric overlays 🚧

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

### Phase 10 — Cross-activity HR zone views

Blocked on **Garmin-Sync Phase 8** (derived analytics tables). Once
pre-aggregated zone distributions land in the sync DB, surface them here as
trend charts: time in Z1–Z5 per week/month, anchored to historically-correct
`lactate_threshold.threshold_hr` at activity date rather than fixed bands.

### Phase 11 — Intraday health charts

Blocked on **Garmin-Sync Phase 7** (intraday sync). Per-minute HR, per-15-min
stress, per-minute steps surfaced as within-day charts on the Dashboard.

### Parked (requires Garmin-Sync work first)

Gear/shoe mileage, body composition.
