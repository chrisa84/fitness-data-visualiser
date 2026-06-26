# AGENTS.md

Guidance for AI agents (and humans) extending this codebase. Read this before
making changes. For orientation, also read [README.md](README.md) (architecture,
API surface, how to run) and [DATA_MODEL.md](DATA_MODEL.md) (every table and
column, with the nullable/never-populated traps). [PLAN.md](PLAN.md) is the
phase history.

## Non-negotiables

These are not obvious from the code and will be violated by a cold start unless
stated:

1. **`garmin_sync.db` is read-only. Always.** It is opened `mode=ro` in `db.ts`
   (`openDb`). Never write to it, never `CREATE`/`ALTER`/`INSERT`/`UPDATE`
   against it. [fitness-data-sync](https://github.com/chrisa84/fitness-data-sync)
   is its sole writer. The **only** writable database is `visualiser-events.db`
   (`openEventsDb`), and it holds only the `event` table.
2. **`shared/` (`@fitness/shared`) is the contract** between server and web. Any
   type or pure helper used by both sides — response shapes, the metric catalog,
   activity groups, event types — lives there. Do not duplicate types across
   server and web.
3. **Charts render through one seam only.** `web/src/Chart.tsx` (and
   `BarChart.tsx`) are the only places that call into ECharts. Build chart
   options with the helpers in `chartHelpers.ts`. Never `import 'echarts'` or
   `echarts.init` in a page — it keeps the charting library swappable.
4. **Every time-series endpoint takes arbitrary `from`/`to` and a `granularity`
   (`day|week|month|year`).** No hard-coded date windows, no display caps.
5. **Activity type is always a filter parameter.** Resolve a filter value
   through `resolveActivityTypeFilter` in `shared/` so raw types (`running`) and
   groups (`group:running`) behave identically. Never hard-code a `type =` in a
   query path that the UI can filter.
6. **Units live in the data layer as metres / seconds / ISO dates.** Convert to
   friendly units (km, min/km, h:mm) in the web layer, not the SQL.
7. **Commits: terse one-line messages** (e.g. `add records page`,
   `fix volume filter`). Do **not** reference AI/Claude in commit messages, PR
   descriptions, code, or docs.

## Architecture in one breath

```
web (React/Vite/ECharts)  →  /api/*  →  server (Fastify)  →  repositories (SQL)
        │                                      │                    │
   api.ts fetchers                     routes/ (zod-validate)   garmin_sync.db (ro)
        │                                      │                 events DB (rw)
   shared/ types ◄───────────── shared/ types ─┘
```

Request flow for every read endpoint: **route** (zod-validate query) → **repository**
(typed SQL, returns a `shared` type) → JSON. The AI chat reuses the same
repository functions as named tools.

## Recipes

### Add a daily metric (Analysis page + AI both pick it up for free)

1. `shared/src/index.ts` → add an entry to `METRIC_CATALOG` (`key`, `label`,
   `unit`, `group`, optional `format`/`better`).
2. `server/src/repositories/metrics.ts` → add the matching entry to `METRIC_SQL`
   (the column `expr` and the `tables` it reads). The key must match the catalog
   exactly. If it reads a new date-keyed table, add it to the `TableName` union.
   For a per-activity (non-date-keyed) metric, add a `DERIVED_SOURCES` subquery
   that aggregates to `(date, …)` and reference it like a table — see
   `run_dynamics` (running form).
3. That's it for wiring: `/api/metrics`, the `get_metric_series` AI tool, and the
   Analysis metric picker all read the catalog — no route or UI change needed.
4. `server/test/metrics.test.ts` enforces `catalogKeysMatchSql()` — add both
   sides or the suite fails.

### Add a new endpoint

1. **Repository:** add a function in `server/src/repositories/<domain>.ts` —
   plain SQL with bound params, returning a `shared` type. Reuse
   `typeFilterClause` for type filters; reuse the date-spine pattern for sparse
   tables (see `performance.ts`).
2. **Shared type:** add the response/point shape to `shared/src/index.ts` if it
   is new.
3. **Route:** add a zod query schema and handler in
   `server/src/routes/<domain>.ts` using the `isoDate` and `badRequest` helpers
   from `routes/validation.ts`. Export a `register…Routes` function.
4. **Wire it:** call that register function in `server/src/app.ts` (pass `db`
   for Garmin reads, `eventsDb` for writable state).
5. **Fetcher:** add a typed fetcher in `web/src/api.ts`.
6. **Test:** add a test in `server/test/<domain>.test.ts` against the fixture DB.

### Add a new page

1. Component in `web/src/pages/<Name>.tsx`. Fetch with TanStack Query via an
   `api.ts` fetcher. Render through `Chart`/`BarChart` (never ECharts directly).
   Use `RangeControls` for date/granularity and `typeOptions.ts` for the
   activity-type dropdown so groups appear automatically.
2. Add the route in `web/src/main.tsx`.
3. Add the nav link in `web/src/Layout.tsx`.

### Add an AI tool

1. Add the tool schema to `TOOL_DEFINITIONS` in `server/src/ai/tools.ts`.
2. Add a `case` to `executeTool` — reuse an existing repository function, coerce
   args, and default sensibly. The tool-use loop in `chat.ts` picks it up
   automatically.
3. Prefer a new named tool over leaning on `run_sql`. `run_sql` is the guarded
   escape hatch (single `SELECT`/`WITH`, read-only connection, 1000-row cap); a
   recurring question shape should become its own tool.
4. Test in `server/test/ai.test.ts` (uses a structural fake client — no network).

### Add a life-event type

Extend `EVENT_TYPES` in `shared/src/index.ts`. The server's zod schema and the
web dropdown both read from it; nothing else to change.

## Running and testing

```bash
npm run dev          # server :3001 + web :5173 (proxied), live reload
npm test             # server vitest suite (in-memory fixture DB)
npm run typecheck    # tsc --noEmit for server and web
npm run build -w web # production build (also typechecks)
```

Tests never touch the real Garmin database — they build a throwaway SQLite DB
from `server/test/fixtures.ts`. The AI tests fake the OpenAI client.

## Gotchas

- **Activities bucket by `date(start_time_local)`** (the user's local day), not
  the UTC `start_time`. Use the same expression for any new activity aggregation.
- **Performance tables are sparse.** `performance.ts` builds a date-spine
  (`UNION` of `date` across the eight tables) then `LEFT JOIN`s. Every metric
  column is independently nullable — assume nulls everywhere.
- **Columns that look like data but never are:** `daily_summary.resting_hr`
  (use `heart_rate.resting_hr`), `body_battery.starting_value`/`ending_value`,
  stress duration buckets, the `lactate_threshold` speed value. See DATA_MODEL.
- **`metrics.ts` only joins the tables the requested keys need** — don't add a
  blanket join.
- **`metrics.test.ts` enforces catalog↔SQL lockstep.** Touch one side, touch the
  other.
- **Port 3001 can stick** after a crashed dev server on Windows. Free it:
  ```powershell
  Get-NetTCPConnection -LocalPort 3001 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
  ```
- **The AI layer is optional.** Without `OPENROUTER_API_KEY`, `/api/chat` returns
  503 and the Chat tab shows a setup hint; everything else must keep working.
- **All web data fetching goes through `apiFetch` in `web/src/api.ts`.** It sets
  `Accept: application/json` and reloads the page on a `401` so an expired
  oauth2-proxy session re-authenticates cleanly (a `403` is left alone — that's
  the wrong-account gate, and reloading would loop). Don't call `fetch()` directly
  for `/api/*` from a page or you'll bypass this.

## Deployment & PWA

The single-container `Dockerfile` (web bundle served by Fastify on one port) is
the deploy unit. For a phone-installable, internet-reachable setup the full
runbook is [deploy/PWA-DEPLOY.md](deploy/PWA-DEPLOY.md) — read it before touching
anything in `deploy/`. Key points an agent will not infer:

- **Auth is at the edge, never in the app.** Loopback has no auth by design (a
  non-negotiable). A public deploy fronts the app with a dedicated oauth2-proxy
  locked to one account. The only in-app hook is the **optional** `ALLOWED_EMAIL`
  gate (an `onRequest` check reading `X-Forwarded-Email`); it's a no-op unless the
  env var is set, so local dev stays open. Keep it that way.
- **PWA wiring lives in `web/vite.config.ts`** (`vite-plugin-pwa`): manifest +
  Workbox service worker, app-shell precache, `NetworkFirst` for `/api` (200s
  only). The data is never precached — the cache is the shell, not the metrics.
- **Icons** are in `web/public/icons/` (a heart-rate glyph on the app's dark
  background). Regenerate with `deploy/make-icons.py` (needs Pillow) if the brand
  colours change; keep the same filenames the manifest references.
