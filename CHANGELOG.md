# Changelog

All notable, user-visible changes to the Fitness Data Visualiser.

Versioning scheme: `0.<phase>.<patch>` — the minor version tracks the
[PLAN.md](PLAN.md) phase that shipped it; the patch is for fixes and small
additions between phases. The authoritative version is `APP_VERSION` in
`shared/src/index.ts` (shown on the Settings page and in `/api/health`).
Bump it and add an entry here with every user-visible change.

Versions 0.19.0 and earlier were backfilled retroactively when versioning was
introduced. 0.12.0 is the baseline bundled in My Fitness 1.0.0 (the desktop
installer); see PLAN.md for the full phase-by-phase history before that.

## 0.19.4 — 2026-07-12

- **The AI chat now reliably answers plain "how has my HR changed" questions**
  instead of timing out. Nothing about "heart rate" told the model which tool
  to use, so it would sometimes reach for `get_intraday` (single-day only) or
  `run_sql` (a full raw scan over years of per-minute rows) instead of the
  cheap daily `resting_hr` metric. The system prompt now explicitly points
  plain HR/training-load questions at the right tool.

## 0.19.3 — 2026-07-08

- **Fixed the installed PWA getting stuck in an endless reload loop after the
  login session expired.** An expired session now re-authenticates by
  navigating to the proxy's sign-in endpoint (which reaches Google and back)
  instead of reloading the page — a plain reload was served the cached app
  shell by the service worker, never reached the proxy, and looped on 401 with
  no way to interact with the page. If re-authentication doesn't succeed, the
  app now shows a tappable "Sign in again" screen instead of looping.

## 0.19.2 — 2026-07-04

- **Weekly buckets are now real Monday dates** (e.g. `2026-06-29`) instead of
  `year-weeknumber` labels, on every weekly chart. Weeks no longer split at
  year boundaries (which previously distorted the Load page's monotony and
  strain for the New Year weeks), life-event overlays now appear on weekly
  charts, and weeks match the Training page's Monday-based weeks.
- The AI chat and plan generation now compute "today" in the server's local
  timezone rather than UTC, fixing wrong "today/yesterday/this week" answers
  in late-evening conversations.
- The AI's raw-SQL tool streams results and stops at the 200-row cap instead
  of loading the full result set first — a runaway query can no longer stall
  the app.
- Faster steady-state heatmap and route requests: backfill pending-work scans
  are skipped until new Garmin data appears, cached heatmap responses (304)
  no longer rebuild the full payload, and route-cluster detail lookups fetch
  only that cluster's activities.

## 0.19.1 — 2026-07-04

- **Similar efforts on the activity page.** An activity on a repeated route
  now shows a "Similar efforts" section — how many times the route has been
  done, all efforts with the current one highlighted, and a link to the
  route's detail page. New endpoint: `GET /api/activities/:id/route-cluster`.

## 0.19.0 — 2026-07-02

- **Routes page (repeated route detection).** Activities that follow the same
  route are grouped by geometric matching of their cached tracks. Cluster
  list with effort count, distance, best pace, and latest date; cluster
  detail with the route map, pace and efficiency-factor trends across
  efforts, and an efforts table — tick two efforts to open them in Compare.
- New endpoints: `GET /api/route-clusters`, `/api/route-clusters/status`,
  `/api/route-clusters/:id`. Matching runs as a lazy, throttled background
  backfill, same pattern as the heatmap.

## 0.18.0 — 2026-07-02

- **Heatmap page.** Every GPS track overlaid on one MapLibre map, with
  activity-type and year filters. Tracks are simplified server-side and
  cached in the events DB by a lazy, throttled backfill; new endpoints
  `GET /api/heatmap` and `/api/heatmap/status`.

## 0.17.1 — 2026-07-02

- The AI chat's raw-SQL tool (`run_sql`) result cap dropped from 1000 to
  200 rows, keeping tool responses inside model context comfortably.

## 0.17.0 — 2026-07-02

- **Global activity-type filter.** The type/group choice persists across the
  analytics pages (Volume, Intensity, Dynamics, Efficiency), like the date
  range already did.
- **Distance filters** (`minKm`/`maxKm`) on the activity list API and UI.
- **Compare picker rework.** The two flat dropdowns became a filterable
  table (name search, date range, min/max km) with A/B pick buttons and a
  "similar distance to A (±10%)" toggle.

## 0.16.0 — 2026-07-02

- **Compare page.** Pick any two activities; stat-diff table plus pace and
  HR overlays by distance. Linked from every activity detail page.
- **Form vs pace scatter** on the Dynamics page — one point per activity
  (VO / vertical ratio / cadence / GCT vs pace), coloured by year.
- **AI activity analysis** on the activity detail page (optional question,
  model dropdown, markdown result), with a new Analysis AI role in Settings.
- **Chart polish:** Intensity legend overlap fixed, dynamics streams
  bucket-averaged, Efficiency outlier clipping became a toggle with
  off-scale markers, EF excludes runs under 3 km.

## 0.15.0 — 2026-07-01

- **AI plan review.** "Ask AI to review" on the Training page proposes
  adjustments to the active plan (scope, how you're feeling, optional
  notes); changes preview as a per-row diff with checkboxes before a
  transactional, re-validated apply. Revision history kept per plan.
- **AI draft revision.** Revise an unsaved plan draft with free-text
  instructions instead of regenerating from scratch, with single-level undo.
- Full workout editing on the active-plan checklist, with server-side
  validation of the merged result.

## 0.14.1 — 2026-07-01

- **Training plan generator rework** after live testing: race date, distance,
  and plan length are now explicit form fields (the AI no longer guesses
  them); deterministic checks on every generated plan (dates inside the
  window, race day placement, no hard sessions in the final two days);
  workout pace ranges alongside point estimates; the fitness-context card
  loads automatically instead of behind a button.
- Fixes: plan duration off-by-one, autofill clobbering in-progress edits,
  pace ranges displaying backwards, missing workout notes display, mobile
  textarea overflow, per-session average for non-running load.

## 0.14.0 — 2026-07-01

- **Training plan generator ("plan maker").** New Training page: describe a
  goal (race or general fitness), set dates and days per week, and the AI
  designs a full workout schedule grounded in your actual recent volume,
  representative runs, and VO2max — previewed and editable before saving,
  then tracked as a tick-off checklist with history of past plans.

## 0.13.0 — 2026-07-01

- **Configurable AI models.** New Settings page: pick the OpenRouter model
  per role (Question AI for chat, Plan AI for the plan generator), up to
  three candidates each, switchable at runtime with no restart.

## 0.12.0 — 2026-06-30

Baseline — the version bundled in My Fitness 1.0.0. Everything up to and
including Phase 12: dashboard, activities + detail (sample charts, route
map with metric overlays on MapLibre), volume/performance/intensity/
dynamics/efficiency/load analytics, cross-metric analysis, records, events,
intraday, route planner with saved routes, AI chat, PWA deploy. See PLAN.md
phases 0–12 for the detail.
