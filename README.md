# Fitness Data Visualiser

A local web app for visualising and analysing the Garmin data mirrored by
[fitness-data-sync](https://github.com/chrisa84/fitness-data-sync)
(`garmin_sync.db`). The goal is richer views than Garmin Connect: arbitrary date
ranges, no display caps, cross-metric analysis, life-event annotations, and a
natural-language query layer.

It is a personal, single-user, localhost app. There is no authentication and it
binds to `127.0.0.1` only.

### Companion to fitness-data-sync

This project is the **visualisation and analysis half** of a pair:

- [**fitness-data-sync**](https://github.com/chrisa84/fitness-data-sync) is the
  ingestion half. It pulls your Garmin Connect data into a local SQLite database
  (`garmin_sync.db`), keeps it current with idempotent, resumable syncs, and
  owns the schema. It also ships its own read-only MCP server for querying that
  database from Claude and other MCP clients.
- **This app** never talks to Garmin. It reads the database that
  fitness-data-sync produces and turns it into a browser UI — charts, filters,
  cross-metric analysis, life-event overlays, and an in-app AI chat.

So: run fitness-data-sync to fill and refresh the database; run this app to look
at it. The two share nothing but the SQLite file, and only this app's
[event database](DATA_MODEL.md) is writable on this side.

> **The Garmin database is never written.** The visualiser opens
> `garmin_sync.db` strictly read-only. Garmin-Sync remains the sole writer. The
> app's own state (life events) lives in a separate, writable database. See
> [DATA_MODEL.md](DATA_MODEL.md) for the full schema picture.

## Architecture

```
                 ┌──────────────────────┐
  React (Vite)   │  web/  :5173          │   ECharts, TanStack Query,
  browser app    │  proxies /api → 3001  │   React Router
                 └───────────┬──────────┘
                             │ HTTP /api/*
                 ┌───────────▼──────────┐
  Fastify API    │  server/  :3001       │   zod validation, repositories
                 │                       │   (plain SQL), AI tool-use loop
                 └─────┬───────────┬─────┘
       read-only (ro)  │           │  read/write
                 ┌─────▼────┐  ┌───▼──────────────────┐
                 │ garmin_  │  │ visualiser-events.db  │
                 │ sync.db  │  │ (life events only)    │
                 └──────────┘  └───────────────────────┘
                       ▲
                 Garmin-Sync (sole writer)
```

- **`server/`** — Fastify (TypeScript, ESM). Reads `garmin_sync.db` via
  `better-sqlite3` opened `{ readonly: true, fileMustExist: true }`. All query
  logic lives in `repositories/` as plain, typed SQL. Request params are
  validated with zod.
- **`web/`** — React + Vite + TypeScript. [Apache ECharts](https://echarts.apache.org)
  for charts (handles 6+ years of daily points with native zoom/brush), TanStack
  Query for fetching/caching, React Router for pages. The Vite dev server proxies
  `/api` to the Fastify server on `:3001`.
- **`shared/`** — types and small pure helpers imported by both sides
  (`@fitness/shared`): the API response shapes, the metric catalog, activity-type
  groups, event types. This is the contract between server and web.

### Design rules (so we don't build into a corner)

1. Every time-series endpoint takes arbitrary `from`/`to` — no hard-coded windows.
2. Aggregation is a server-side parameter (`day | week | month | year`) returning
   one consistent time-series shape.
3. Query logic is plain SQL in repository modules with typed results. The AI
   layer reuses these same functions as named tools, plus a guarded read-only
   SQL tool.
4. Activity type is always a filter parameter, never baked in. Groups
   (`group:running`) resolve to a `type IN (...)` set in `shared/`.
5. Units, timezone, and date maths live in `shared/`.
6. Charts render through a single seam (`web/src/Chart.tsx`) so the charting
   library can be swapped without touching pages.

## Getting started

Prerequisites: Node 20+, and a populated `garmin_sync.db` produced by
[fitness-data-sync](https://github.com/chrisa84/fitness-data-sync).

```bash
npm install

# Run server (:3001) and web (:5173) together with live reload
npm run dev
```

Then open <http://localhost:5173>.

Point the server at your Garmin-Sync database with `GARMIN_DB_PATH` (there is no
usable default — it ships as a `/path/to/garmin_sync.db` placeholder). Other
settings are overridable too (see below). The writable events database
(`visualiser-events.db`) is created automatically on first run in the server's
working directory and is git-ignored.

### Configuration

Server config is read from the environment (and `server/.env`, loaded via
dotenv). All values have defaults; copy `server/.env.example` to `server/.env`
only if you need to change them or enable the AI layer.

| Variable              | Default                                  | Purpose                                          |
| --------------------- | ---------------------------------------- | ------------------------------------------------ |
| `GARMIN_DB_PATH`      | `/path/to/garmin_sync.db`                | Path to the read-only Garmin mirror. Set this to your Garmin-Sync database. |
| `EVENTS_DB_PATH`      | `visualiser-events.db`                   | Path to the writable events database.            |
| `PORT`                | `3001`                                   | Fastify listen port.                             |
| `HOST`                | `127.0.0.1`                              | Listen host. Loopback locally; set to `0.0.0.0` in a container. |
| `WEB_DIST_PATH`       | _(unset)_                                | When set, the server also serves the built web bundle from this directory. Unset in dev (Vite serves the web). |
| `OPENROUTER_API_KEY`  | _(unset)_                                | Enables the Chat tab. Without it, chat returns 503; everything else works. |
| `OPENROUTER_MODEL`    | `anthropic/claude-3.7-sonnet`            | Any OpenRouter model slug that supports tool calling. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1`           | OpenAI-compatible endpoint base URL.             |

## Deployment (Docker / Coolify)

The repo ships a single-container [`Dockerfile`](Dockerfile): a multi-stage build
that compiles the web bundle and serves it from the Fastify server alongside
`/api`. One image, one port — no separate web container or reverse proxy needed.

```bash
docker build -t fitness-visualiser .
docker run -p 3001:3001 \
  -v /host/path/to/data:/data \
  -e OPENROUTER_API_KEY=sk-... \
  fitness-visualiser
```

The container expects a mounted `/data` volume holding `garmin_sync.db` (and
where it will create `visualiser-events.db`). It sets `HOST=0.0.0.0`,
`WEB_DIST_PATH=/app/web/dist`, and points the DB paths at `/data` by default.

For **Coolify**: point it at this repo, choose the Dockerfile build, map a
persistent volume to `/data`, expose port `3001`, and set `OPENROUTER_API_KEY`.
Keep `garmin_sync.db` current by syncing it into that volume with
[fitness-data-sync](https://github.com/chrisa84/fitness-data-sync).

> The only native dependency is `better-sqlite3`; the build stage includes a
> compiler toolchain as a fallback in case no prebuilt binary matches your
> platform. It is confined to the build stage, so the runtime image stays slim.
> Those three `apt-get` lines can be removed for a leaner build if the prebuilt
> always resolves for you.

## Project layout

```
shared/src/index.ts          Shared types, metric catalog, activity groups, event types
server/src/
  index.ts                   Entrypoint: load config, build app, listen
  app.ts                     Wire DB connections + routes; create AI client
  config.ts                  Environment → Config
  db.ts                      openDb (read-only) / openEventsDb (writable + schema)
  repositories/              Plain typed SQL, one module per domain
    dailyHealth.ts             daily health/sleep/HRV/body-battery series
    activities.ts              list, detail+splits, volume, type filter helper
    performance.ts             performance series (date spine) + HR-zone intensity
    metrics.ts                 metric-catalog series (only joins needed tables)
    records.ts                 personal records derived from the activity table
    events.ts                  CRUD against the writable events DB
  routes/                    Fastify routes: zod-validate, call repository
    validation.ts              isoDate + badRequest helpers
  ai/
    tools.ts                   Tool schemas, executeTool dispatch, run_sql guard
    chat.ts                    System prompt + tool-use loop (runChat)
web/src/
  Chart.tsx / BarChart.tsx   The single ECharts render seam
  chartHelpers.ts            baseOption / line / bar builders
  events.ts / chartEvents.ts Event overlays (marklines / markareas)
  api.ts                     Typed fetchers for every endpoint
  pages/                     One file per route (Dashboard, Activities, …, Chat)
```

## API surface

All endpoints are under `/api`. Time-series endpoints accept `from`, `to`
(`YYYY-MM-DD`) and `granularity` (`day|week|month|year`); omitted dates default
to an open range.

| Method | Path                          | Purpose                                                              |
| ------ | ----------------------------- | ------------------------------------------------------------------- |
| GET    | `/api/health`                 | Liveness + `daily_summary` row count.                               |
| GET    | `/api/daily-health`           | Resting HR, steps, stress, sleep, HRV, body battery, intensity.     |
| GET    | `/api/activities`             | Filtered/sorted/paginated activity list (`type`, `q`, `sort`, …).   |
| GET    | `/api/activity-types`         | Distinct activity types with counts.                                |
| GET    | `/api/activities/:id`         | Full activity detail + splits.                                      |
| GET    | `/api/activity-volume`        | Count/distance/duration/elevation aggregated per bucket.            |
| GET    | `/api/performance`            | VO2max, load, ACWR, readiness, race predictions, scores, status.    |
| GET    | `/api/intensity-distribution` | Seconds in each HR zone, summed per bucket.                         |
| GET    | `/api/metrics`                | Multi-metric series from the catalog (`keys=a,b,c`, max 8).         |
| GET    | `/api/records`                | Derived personal records.                                           |
| GET    | `/api/events`                 | Life events overlapping an optional window.                        |
| POST   | `/api/events`                 | Create an event. (writable DB)                                      |
| PATCH  | `/api/events/:id`             | Update an event. (writable DB)                                      |
| DELETE | `/api/events/:id`             | Delete an event. (writable DB)                                      |
| GET    | `/api/chat/status`            | Whether the AI layer is enabled, and the configured model.          |
| POST   | `/api/chat`                   | Natural-language query (tool-use loop). 503 if no API key.          |

The activity-type filter accepts a raw Garmin type (`running`) or a group
(`group:running`, `group:cycling`, `group:swimming`, `group:walking`).

## Pages

- **Dashboard** — health & recovery overview; 8 charts, each individually
  toggleable (persisted in the `?hidden=` URL param); life events overlaid.
- **Activities** — filterable, sortable, paginated list → activity detail with
  splits, HR zones, running dynamics.
- **Volume** — distance/duration/elevation/count over time by type/group.
- **Performance** — VO2max, training load + ACWR (risk zones shaded), readiness
  and its factor breakdown, race-prediction trends, lactate threshold, endurance
  and hill scores, and a colour-coded training-status timeline.
- **Intensity** — HR-zone stacked bars (hours or %) by type/group.
- **Analysis** — overlay (up to 5 normalised metrics), compare (one metric across
  two ranges), correlate (X vs Y scatter with optional lag, Pearson r).
- **Records** — derived personal records.
- **Events** — CRUD for life events (races, injury, illness, medication, travel,
  notes); point and ranged.
- **Chat** — natural-language questions answered via the AI query layer.

## AI query layer

The Chat tab is powered by OpenRouter (OpenAI-compatible) via the `openai` SDK.
It is **tool-use**, not text-to-SQL-by-default:

1. The model receives the question plus a list of named tools (the repository
   functions: `get_metric_series`, `list_activities`, `get_activity_volume`,
   `get_performance_series`, `get_records`, `list_events`) and one guarded
   escape hatch, `run_sql`.
2. The model only _requests_ a tool by emitting JSON. The **server** executes the
   tool in-process against the local read-only database and feeds the JSON
   result back. This loop runs up to 8 steps, then the model answers.
3. Nothing about the machine or database leaves the network boundary — only the
   small JSON results of tool calls are sent to OpenRouter, and only when the AI
   layer is enabled.

`run_sql` is deliberately constrained: a single statement, `SELECT`/`WITH` only,
run on the read-only connection, with rows capped at 1000. It exists for
questions the named tools can't express; the preferred path is to add a new named
tool when a question shape recurs. Without `OPENROUTER_API_KEY` the whole layer
is disabled and every other feature is unaffected.

## Testing

```bash
npm test           # server vitest suite (runs against an in-memory fixture DB)
npm run typecheck  # tsc --noEmit for server and web
npm run build -w web
```

Server tests build a throwaway SQLite database from fixtures, so they never touch
the real Garmin mirror. The AI tests use a structural fake of the OpenAI client,
so they exercise the tool-use loop without any network calls. One test
(`metrics.test.ts`) asserts the metric catalog and the SQL map stay in lockstep.

## Parked (needs Garmin-Sync work first)

GPS routes/maps, in-activity per-second sample charts, gear/shoe mileage, body
composition. These depend on data Garmin-Sync does not yet mirror. See
[PLAN.md](PLAN.md) for the full phase history.
