# EXPERIMENTS.md

Trial features living under the **Experimental** nav section. Each is designed
to be removed cleanly if it doesn't earn its keep — this file is the map of
exactly what to delete per feature. Keep it current: adding an experimental
feature means adding its removal recipe here; promoting or removing one means
deleting its entry.

## Shared experimental plumbing

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

**To remove the whole experiment:** delete the seven items above and this
file's entries. Nothing else references them.

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
