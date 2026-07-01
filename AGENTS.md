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
- **The AI model is user-configurable, not an env var.** `visualiser-events.db`
  holds a single-row `ai_settings` table (Question AI / Plan AI roles, up to 3
  candidate model strings each, one active) managed via
  `repositories/aiSettings.ts` / `GET`+`PUT /api/ai-settings` / the Settings
  page. `routes/chat.ts` reads the active Question AI model per-request via
  `getAiSettings` — don't reintroduce a boot-time model constant. Plan AI's
  first (and so far only) consumer is the training-plan generator (Phase 14).
- **Training plans: one active at a time, and `workout_type` is a closed
  enum.** `createTrainingPlan` (`repositories/trainingPlans.ts`) throws
  `ActivePlanExistsError` (→ `409`) if `getActiveTrainingPlan` already returns
  a row — end the current plan before starting another, there's no DB
  constraint enforcing this, just a check-then-insert in the repository.
  `workout_type` is `easy | long | tempo | interval | race`
  (`WORKOUT_TYPES` in `shared/`) — deliberately no `rest`/`cross_training`;
  a date with no workout row *is* the rest day, and prescribing non-running
  sessions was scoped out (see `PLAN.md` Phase 14 for why).
- **Race date, distance, and plan length are user-supplied facts, not AI
  output (Phase 14.1 — this reverses Phase 14's original call).** Live
  testing showed the model inferring these from free text produced workouts
  landing outside the stated plan window (a "race" row one day past the
  plan's own `endDate`). `GenerateTrainingPlanRequest` now carries `isRace`,
  `raceDate`, `goalRaceDistanceM`, `goalTargetDurationS` and `durationWeeks`
  as explicit form fields; `routes/trainingPlanGeneration.ts`'s exported
  `computeEndDate` computes `endDate` deterministically (`raceDate` when
  racing, else `startDate + durationWeeks*7 - 1` days — **not** `*7`; a
  1-week plan starting Monday ends the following Sunday, 7 days total, not
  the Monday after, since `startDate` itself is the first of those days)
  *before* calling `generatePlan` — the model is told these as hard facts,
  it never chooses them. `Training.tsx`'s own client-side mirror of this
  calculation (for the events-overlap preview) must stay in sync with the
  same `*7 - 1` — it drifted once already.
- **The AI's actual output is just `{ rationale, workouts[] }`
  (`AiProposedPlan` in `ai/planGeneration.ts`, not exported from `shared`).**
  The route merges this with the user-supplied hard facts above to build the
  full `GeneratedTrainingPlan` returned to the client — don't add
  goalDescription/isRace/dates back into `PROPOSE_PLAN_TOOL`'s schema, that's
  the exact per-call structured-output surface area that made generation
  less reliable.
- **Plan generation forces a terminal tool call — it does not reuse
  `runChat`.** `ai/planGeneration.ts`'s `generatePlan` runs its own loop,
  dispatching through the same `executeTool`, but only offers a small
  plan-relevant subset of `TOOL_DEFINITIONS` (`PLAN_DATA_TOOLS`:
  `get_records`, `get_performance_series`, `get_activity_volume`,
  `list_events`) — not the full chat toolset, which is unnecessary weight for
  this task and more likely to trip up weaker/cheaper models. On the last
  allowed step, the tool list narrows to just `propose_plan` and
  `tool_choice` becomes `'required'` — deliberately **not** the named-function
  form (`{type:'function', function:{name:'propose_plan'}}`); forcing one
  specific function by name needs each provider/aggregator to translate that
  exact semantic correctly, which is a known weak spot for non-OpenAI-native
  backends (Gemini, DeepSeek, etc. via OpenRouter) — `'required'` with a
  single-entry tool list gets the same guarantee without depending on that.
  Don't add either the tool-trimming or the forcing logic to `ai/chat.ts`'s
  `runChat` — that one must stay generic for ordinary chat. The
  `propose_plan` arguments are zod-validated against
  `schemas/trainingPlan.ts`'s `aiProposedPlanSchema`; a bad value throws
  `PlanGenerationError`. After a valid parse, `generatePlan` also runs a
  small set of **deterministic, non-negotiable checks** rather than trusting
  the prompt alone: every workout date falls within `[startDate, endDate]`,
  and — when `isRace` — exactly one `workoutType:'race'` row exists dated
  exactly `endDate`, with no `long`/`tempo`/`interval` session in the final 2
  days before it. A violation throws `PlanGenerationError` (same `502` path,
  no repair/retry pass — the user just clicks Regenerate). Broader coaching
  rules (weekly progression, hard-day spacing beyond the race-week check,
  session frequency) remain prompt guidance only, deliberately not promoted
  to hard checks. `routes/trainingPlanGeneration.ts`'s catch block logs and
  returns a clean `502` JSON body (`{error, message}`) for **any** caught
  error, not just `PlanGenerationError` — matching `chat.ts`'s catch-all —
  so a genuine OpenRouter/network failure surfaces as `error: 'ai_error'`
  with the real message instead of an unlogged, re-thrown exception. The
  system prompt also carries explicit coaching guidance (cap hard sessions
  to one tempo + one interval per week, flag infeasible goals in `rationale`
  instead of refusing, ground `rationale` in the actual autofill numbers,
  give every workout a pace — a min/max range for easy/long runs, a point
  estimate otherwise) — these aren't obvious from the tool schema alone and
  exist specifically to help weaker/cheaper models produce a sane plan;
  don't strip them out as "just prose."
- **`GET /api/training-plans/autofill` costs zero AI tokens, and the web
  page calls it automatically on mount** (not gated behind a button —
  autofill just refreshes it). It's plain repository queries
  (`repositories/trainingPlanAutofill.ts`). Weekly volume
  (`weeklyVolumeTrend`/`weeklyVolumeAvgKm`) is computed from a **zero-filled
  calendar-week spine** (last 6 complete Monday-start weeks, via a SQL
  `VALUES` spine LEFT JOINed against `activity`) — not a plain `GROUP BY`,
  which would silently skip weeks with zero runs and inflate the average.
  "Relevant pace" is `representativeRuns` — up to 4 real runs from the last
  ~90 days (longest / fastest effort / typical / most recent, deduplicated
  by activity) — not all-time personal records (`getRecords` is unrelated
  and unused here; `longest_ride`/`biggest_climb`/`highest_vo2max` records
  have nothing to do with running pace and were the source of the original
  "wtf is this" garbage output before this rework). `representativeRuns`
  carries the activity `type` and `elevationGainM` alongside pace — trail/
  hilly effort pace isn't comparable to flat road pace, so the prompt is
  told to treat them differently rather than setting a road-pace target off
  a hilly run.
- **`Training.tsx`'s autofill-overrides sync effect fires once, not on every
  refetch.** `useQuery`'s defaults (`refetchOnWindowFocus`/
  `refetchOnReconnect`) mean `autofillQuery.data` can change in the
  background — e.g. foregrounding the installed PWA — with no user action.
  A naive `useEffect(() => setOverrides(...), [autofillQuery.data])` would
  silently clobber whatever the user had already typed into the editable
  fields. It's guarded with a `useRef` so it only syncs from the first
  successful fetch; "Refresh from Garmin" still updates the read-only
  trend/representative-run display (which reads `autofillQuery.data`
  directly), just not the editable override fields.
- **Workout edits are validated on the *merged* result, not the raw PATCH
  body.** `updateWorkout` (`repositories/trainingPlans.ts`) merges
  `{...existing, ...patch}` before checking the window bound / pace-range
  order / tempo-interval-description invariants — a partial patch touching
  only `title` can't be checked for "does this tempo workout still have a
  description" in isolation, since that depends on the pre-existing
  `workoutType`/`description` too. Throws `WorkoutValidationError` → `400`.
  Don't move these checks into `trainingPlanWorkoutUpdateBody` (the zod
  schema) — it's `.partial()`, so it has no visibility into the existing row.
- **`POST /api/training-plans/revise` reuses `generatePlan` via a
  prompt-only branch, not a parallel code path.** Passing a `revision`
  option swaps `systemPrompt`'s opening framing ("you are editing this, not
  designing a fresh one" + the current draft) but keeps every hard fact,
  coaching rule, and deterministic post-generation check identical to a
  fresh generation — same schema, same validation, same reliability
  characteristics. Don't build a second tool-loop or a separate validation
  path for revisions; the only thing that should ever differ is the prompt
  content. `ReviseTrainingPlanRequest` carries `goalDescription`/
  `preferredDays`/`preferredLongRunDay`/`otherTraining`/`upcomingNotes`
  alongside the dates/race facts — every field `buildPlanSummary` reads,
  minus `raceDate`/`durationWeeks`/`autofill` (the revised draft already has
  a concrete `endDate`, nothing to re-derive). Don't drop any of these when
  touching this route — a revision missing one silently loses context the
  original generation had. `formatWorkoutForPrompt`'s per-workout listing
  includes duration/description/notes, not just date/type/title/distance/
  pace — "preserve everything else" requires the model to actually see
  everything else (a tempo workout's required `description` is otherwise
  invisible during revision). The free-text `instructions` are sent as a
  separate `{role:'user'}` message, not folded into the system prompt —
  keep that split if you touch `generatePlan`'s message construction.
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
  locked to one account. The in-app hook is the `ALLOWED_EMAILS` gate (an
  `onRequest` check reading `X-Forwarded-Email`, comma-separated allowlist;
  `ALLOWED_EMAIL` is a legacy alias). It's a no-op with no allowlist **unless**
  auth is required, so local dev stays open. When set it gates the **whole** app
  (shell and PWA assets included, not just `/api`) so a wrong-account session sees
  nothing at all. It **fails closed**: in deploy posture (`WEB_DIST_PATH` set, or
  `REQUIRE_AUTH=1`) a missing allowlist makes the server refuse to start rather
  than silently open. Keep local dev (no bundle) able to run open.
- **PWA wiring lives in `web/vite.config.ts`** (`vite-plugin-pwa`): manifest +
  Workbox service worker, app-shell precache, `NetworkFirst` for `/api` (200s
  only). The data is never precached — the cache is the shell, not the metrics.
- **Icons** are in `web/public/icons/` (a heart-rate glyph on the app's dark
  background). Regenerate with `deploy/make-icons.py` (needs Pillow) if the brand
  colours change; keep the same filenames the manifest references.
