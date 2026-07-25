# EXPERIMENTS.md

Trial features living under the **Experimental** nav section. Each is designed
to be removed cleanly if it doesn't earn its keep — this file is the map of
exactly what to delete per feature. Keep it current: adding an experimental
feature means adding its removal recipe here; promoting or removing one means
deleting its entry.

## What lives under `/api/experimental`

Three independent experiments, each with its own repository, route, shared
types and page. They share only the `/api/experimental` prefix and the
`Experimental` nav group, so any one can be removed without touching the
others.

| Experiment | Endpoint | Page |
| --- | --- | --- |
| Fitness trend (Phase 20) | `GET /api/experimental/fitness-trend` | `/experimental/fitness-trend` |
| Sleep timing (Phase 21) | `GET /api/experimental/sleep-timing` | `/experimental/sleep-timing` |
| Cohort comparison (Phase 21) | `GET /api/experimental/cohort` | `/experimental/cohort` |

All three routes are registered by the single `registerExperimentalRoutes` in
`server/src/routes/experimental.ts`. Removing the last one means deleting that
file, its `registerExperimentalRoutes(app, db)` call in `server/src/app.ts`,
and the `Experimental` group in `web/src/Layout.tsx`.

> **Note:** `ActivityRouteClusterResponse` used to sit inside the EXPERIMENTAL
> block in `shared/src/index.ts` despite being production Phase 19 code. It has
> been moved up next to `RouteClusterDetail` so "delete the EXPERIMENTAL block"
> is a safe instruction. Keep it that way.

## Shared Fitness Trend plumbing

All Fitness Trend experiments ride on one endpoint and one page:

| Piece | Location |
| --- | --- |
| Endpoint | `GET /api/experimental/fitness-trend` — `server/src/routes/experimental.ts`, registered in `server/src/app.ts` |
| Repository | `server/src/repositories/experimental.ts` (`getFitnessTrend`) |
| Shared types | the `EXPERIMENTAL` block in `shared/src/index.ts` (`FitnessTrendResponse` and its point types) |
| Fetcher | `fetchFitnessTrend` in `web/src/api.ts` |
| Page | `web/src/pages/FitnessTrend.tsx`, route `/experimental/fitness-trend` in `web/src/main.tsx` |
| Nav | the `Experimental` group in `NAV_GROUPS`, `web/src/Layout.tsx` |
| Test | `server/test/experimental.test.ts` |

**To remove the whole experiment:** delete the seven items above (leaving
`registerExperimentalRoutes` in place if another experiment still uses it) and
this file's entries. Nothing else references them.

Note `web/src/chartHelpers.ts`'s `timeAxisOption` started here but is now
shared with the Sleep Timing page — leave it alone when removing this one.

## The experiments

### 1. %HRR-normalised efficiency factor

Speed per percent of heart-rate reserve, per bucket. Reserve uses the same-day
(or ≤30-day-old) resting HR from `heart_rate` and a rolling 12-month max
observed HR across all activities — so the metric self-adjusts as max HR falls
with age, unlike the classic EF (speed/HR) it is charted against. Steady,
roughly flat (≤25 m gain/km) runs ≥3 km only.

- Server: the `hrrEf` series in `getFitnessTrend`.
- Web: the "%HRR-normalised efficiency" section of `FitnessTrend.tsx` (which
  also fetches the classic `/api/efficiency` series for comparison).
- Remove alone: delete the `hrrEf` computation + `HrrEfficiencyPoint` type +
  the page section.
- Promote: fold into `server/src/repositories/efficiency.ts` /
  the Efficiency page as another series.

### 2. Rolling best-effort VDOT

Daniels VDOT computed (client-side, `vdotFromEffort`) from Garmin's
`fastest_km_s` / `fastest_5k_s` best-split columns, scatter per effort plus a
90-day rolling best line. Data limitation: Garmin only populates the
best-split columns on recent activities (~2024 onwards).

- Server: the `bestEfforts` list in `getFitnessTrend`.
- Web: the "Rolling best-effort VDOT" section + `vdotFromEffort` in
  `FitnessTrend.tsx`.

### 3. Age-graded 5k performance

Best 5k efforts scored against an age-adjusted world standard so the trend is
meaningful across ageing. Uses **approximate** WMA road factors (5-year
anchor points, linearly interpolated) hardcoded in `FitnessTrend.tsx`
(`AGE_FACTORS_5K`), not official tables. Date of birth and sex are entered on
the page and stored **only in localStorage** (`fdv:dob`, `fdv:sex`) — nothing
server-side, nothing in any DB.

- Entirely client-side over the same `bestEfforts` data as #2; remove its page
  section (and the localStorage keys become inert).

### 4. Temperature vs pace scatter

Every steady run's watch-recorded average temperature (`temp_avg_c`, populated
from ~2021) against its pace — personal heat sensitivity. Caveat: the watch
thermometer reads skin/sun heating, so warm-day values skew high.

- Server: the `tempPace` list in `getFitnessTrend`.
- Web: the "Temperature vs pace" section of `FitnessTrend.tsx`.

### 5. Sleep timing & regularity (Phase 21)

When you sleep rather than how much: bedtime, wake time and midpoint on a
night-centred clock axis, a rolling 14-night regularity std dev, weekly
weekend-vs-weekday social jetlag, and a midpoint-vs-next-morning scatter
(resting HR / HRV / readiness / body battery).

Built on `sleep.sleep_start` and `sleep.sleep_end`, which nothing else in the
app reads. Two things are load-bearing and non-obvious:

- **Clock times are night-centred minutes** (23:40 → -20, 06:30 → 390). On a
  plain 0–1439 minute-of-day scale, two nights twenty minutes apart across
  midnight average to midday and the std dev explodes — which is exactly the
  metric this page exists to measure.
- **Local time, not UTC.** Garmin stores UTC instants; `nightCentredMinutes`
  renders them via `Date#getHours()` in the server's timezone, matching
  `localToday()` and the documented "set `TZ` in deployment" convention.
  Reading them as UTC would shift every bedtime by the offset and inject a
  fake 60-minute regularity jump at each DST boundary.

`sleep.date` is the **wake** date, so the health metrics joined on that same
date are already the morning-after readings — no lag is applied, and none
should be added.

| Piece | Location |
| --- | --- |
| Repository | `server/src/repositories/experimentalSleep.ts` |
| Route | the `sleep-timing` handler in `server/src/routes/experimental.ts` |
| Shared types | `SleepNightPoint`, `SocialJetlagPoint`, `SleepTimingResponse` |
| Fetcher | `fetchSleepTiming` in `web/src/api.ts` |
| Page | `web/src/pages/SleepTiming.tsx`, route in `web/src/main.tsx` |
| Nav | the `Sleep timing` entry in the `Experimental` group |
| Tests | `server/test/experimentalSleep.test.ts`, plus the sleep-timing case in `server/test/tagRoutes.test.ts` |

**Promote:** it deserves its own top-level Sleep page (probably merged with
the Dashboard's sleep charts) and `sleep_midpoint` / `sleep_regularity` entries
in `METRIC_CATALOG` so the Analysis and Cohort pages can use them.

**Remove:** delete the seven items above. The fixture columns
(`sleep_start`/`sleep_end` in `server/test/fixtures.ts`) can stay — they cost
nothing and mirror the real schema.

### 6. Cohort comparison (Phase 21)

Splits every day by a threshold condition on one catalog metric and compares
another catalog metric between the two groups, at an optional lag ("resting HR
the morning after a night under 6 hours, versus every other morning"). Reports
n / mean / sd / median / quartiles / range per group, plus the mean difference
with an approximate 95% Welch interval.

Entirely built on `getMetricSeries`, so every catalog metric works on both
sides for free and there is no new SQL to drift. The interval uses a 1.96
normal approximation rather than a t distribution — over the hundreds of days
these run on, the correction is under a percent, and the real limitation is
that this is observational data, which the page says plainly.

| Piece | Location |
| --- | --- |
| Repository | `server/src/repositories/experimentalCohort.ts` |
| Route | the `cohort` handler in `server/src/routes/experimental.ts` |
| Shared types | `COHORT_OPS`, `CohortOp`, `COHORT_OP_LABELS`, `CohortStats`, `CohortResponse` |
| Fetcher | `fetchCohort` in `web/src/api.ts` |
| Page | `web/src/pages/Cohort.tsx`, route in `web/src/main.tsx` |
| Nav | the `Cohort` entry in the `Experimental` group |
| Tests | `server/test/experimentalCohort.test.ts`, plus the validation case in `server/test/tagRoutes.test.ts` |

**Promote:** fold it into the Analysis page as a fourth mode alongside
overlay / compare / correlate, where it naturally belongs.

**Remove:** delete the seven items above. Nothing else references them.
