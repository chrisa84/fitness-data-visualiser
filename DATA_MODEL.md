# Data Model

This document describes the data the Fitness Data Visualiser reads and writes.

There are two SQLite databases, with a strict boundary between them:

| Database                | Owner          | Access from this app | Contents                          |
| ----------------------- | -------------- | -------------------- | --------------------------------- |
| `garmin_sync.db`        | **Garmin-Sync**| **Read-only** (`mode=ro`) | All Garmin activity & health data |
| `visualiser-events.db`  | **This app**   | Read/write           | Life-event annotations only       |

> **Source of truth.** [fitness-data-sync](https://github.com/chrisa84/fitness-data-sync)
> owns `garmin_sync.db` and its schema; this visualiser is its read-only
> companion. This
> document describes only the tables and columns the visualiser **reads** — it is
> not the authoritative schema definition. If Garmin-Sync changes a column, the
> repository SQL is where the visualiser couples to it. The visualiser holds no
> write lock on this database; WAL mode means it never blocks a sync.

Conventions throughout the Garmin data:

- **Distances** are metres, **durations** seconds, **dates** ISO `YYYY-MM-DD`.
- Daily tables are keyed by `date`; the `activity` tables by `activity_id`.
- Almost every metric column is independently nullable — Garmin records
  different metrics on different cadences and devices, so a row existing does not
  mean every column is populated.

---

## Read-only Garmin tables (`garmin_sync.db`)

### Daily health tables (keyed by `date`)

Joined together by `dailyHealth.ts` to build the dashboard series. The base
table is `daily_summary`; the rest are `LEFT JOIN`ed on `date`.

#### `daily_summary`

| Column                       | Read as                  | Notes                                  |
| ---------------------------- | ------------------------ | -------------------------------------- |
| `date`                       | bucket key               | Join key for all daily tables.         |
| `total_steps`                | steps                    |                                        |
| `avg_stress_level`           | stress                   | Avg/max stress only.                   |
| `body_battery_highest`       | body battery (peak)      | Daily high.                            |
| `body_battery_lowest`        | body battery (low)       | Daily low.                             |
| `moderate_intensity_minutes` | moderate intensity       |                                        |
| `vigorous_intensity_minutes` | vigorous intensity       |                                        |
| `resting_hr`                 | _(ignored)_              | **Never populated** — resting HR is read from `heart_rate` instead. |

> Stress _duration_ buckets (time in each stress band) are never populated, so
> only average/max stress levels are surfaced.

#### `heart_rate`

| Column        | Read as     | Notes                                            |
| ------------- | ----------- | ------------------------------------------------ |
| `date`        | join key    |                                                  |
| `resting_hr`  | resting HR  | The real source of resting HR (see above).       |

#### `sleep`

| Column                  | Read as          |
| ----------------------- | ---------------- |
| `date`                  | join key         |
| `sleep_score`           | sleep score      |
| `total_sleep_seconds`   | total sleep      |
| `deep_sleep_seconds`    | deep sleep       |
| `light_sleep_seconds`   | light sleep      |
| `rem_sleep_seconds`     | REM sleep        |
| `awake_seconds`         | awake            |

#### `hrv`

| Column           | Read as            | Notes                              |
| ---------------- | ------------------ | ---------------------------------- |
| `date`           | join key           |                                    |
| `last_night_avg` | HRV (nightly)      |                                    |
| `weekly_avg`     | HRV (weekly)       |                                    |
| `baseline_low`   | HRV baseline band  | Lower edge of the baseline band.   |
| `baseline_high`  | HRV baseline band  | Upper edge of the baseline band.   |

#### `body_battery`

| Column          | Read as              | Notes                                        |
| --------------- | -------------------- | -------------------------------------------- |
| `date`          | join key             |                                              |
| `charged`       | body battery charged |                                              |
| `drained`       | body battery drained |                                              |
| `starting_value`| _(ignored)_          | **Never populated**; peak/low come from `daily_summary`. |
| `ending_value`  | _(ignored)_          | **Never populated.**                         |

---

### Activity tables

#### `activity` (keyed by `activity_id`)

The widest table. The list view reads a subset; the detail view reads the full
row. Columns read:

**List / summary:** `activity_id`, `name`, `type`, `start_time`,
`start_time_local`, `distance_m`, `duration_s`, `moving_duration_s`,
`elapsed_duration_s`, `avg_hr`, `max_hr`, `avg_speed_mps`, `max_speed_mps`,
`elevation_gain_m`, `elevation_loss_m`, `calories`, `aerobic_te`,
`anaerobic_te`, `training_load`.

**Cadence / power / dynamics:** `avg_cadence`, `max_cadence`, `avg_power`,
`max_power`, `norm_power`, `avg_respiration_rate`, `ground_contact_ms`,
`vertical_oscillation_cm`, `vertical_ratio_pct`, `stride_length_cm`.

**Per-activity scores & misc:** `vo2max`, `activity_steps`,
`body_battery_delta`, `temp_avg_c`, `water_estimated_ml`, `stamina_start`,
`stamina_end`, `stamina_min`.

**HR zones (seconds):** `hr_zone_1_s` … `hr_zone_5_s`. Present on only a minority
of activities (depends on device/sport); the intensity view filters to rows
where at least one zone is set.

**Best-split records:** `fastest_km_s`, `fastest_mile_s`, `fastest_5k_s` —
Garmin's pre-computed bests per activity, used to derive personal records.

`start_time_local` is the field used for all date filtering and bucketing
(`date(start_time_local)`), so activities bucket by the user's local day.

#### `activity_split` (keyed by `activity_id`, ordered by `split_index`)

| Column                                  | Notes                                            |
| --------------------------------------- | ------------------------------------------------ |
| `split_index`, `split_type`             | Order and type label.                            |
| `distance_m`, `duration_s`, `moving_duration_s` |                                          |
| `avg_hr`, `max_hr`, `avg_speed_mps`     |                                                  |
| `avg_cadence`, `avg_power`, `calories`  |                                                  |
| `elevation_gain_m`, `elevation_loss_m`  |                                                  |
| `ground_contact_ms`, `vertical_oscillation_cm` |                                           |

> These rows are Garmin **splitSummaries** (interval / run-walk-detection
> segments), **not** per-kilometre splits. `activity_lap` exists in the mirror
> but is empty, so it is not used.

---

### Performance tables (keyed by `date`)

`performance.ts` builds a **date spine** — `UNION` of `date` across all eight
tables below — then `LEFT JOIN`s each one, so a row appears for any day on which
**any** performance metric exists. Each metric is independently nullable.

| Table                | Columns read                                                              | Surfaced as                                  |
| -------------------- | ------------------------------------------------------------------------ | -------------------------------------------- |
| `training_status`    | `vo2max`, `vo2max_precise`, `acute_load`, `chronic_load`, `acwr`, `training_status_phrase` | VO2max, training load, ACWR, status timeline |
| `training_readiness` | `score`, `hrv_factor_pct`, `sleep_factor_pct`, `stress_factor_pct`, `recovery_time_min` | Readiness + factor breakdown          |
| `race_predictions`   | `race_5k_s`, `race_10k_s`, `race_half_s`, `race_full_s`                   | Predicted race times                         |
| `max_metrics`        | `vo2max`, `vo2max_precise`                                                | VO2max fallback when `training_status` is null |
| `lactate_threshold`  | `threshold_hr`, `threshold_power_w`                                       | Lactate threshold (HR + power)               |
| `endurance_score`    | `score`                                                                   | Endurance score                              |
| `hill_score`         | `overall_score`, `strength_score`, `hill_endurance_score`                 | Hill score breakdown                         |
| `fitness_age`        | `fitness_age`                                                             | Fitness age                                  |

Notes:

- VO2max is `COALESCE(training_status.vo2max, max_metrics.vo2max)` — the status
  table is preferred, `max_metrics` fills gaps.
- `training_status_phrase` is a text label (e.g. "Productive") and is only
  surfaced at **day** granularity — a phrase can't be averaged into a bucket.
- `lactate_threshold` also stores a speed value, but it is an **unreliable unit**
  and is deliberately omitted.

---

## Writable table (`visualiser-events.db`)

The visualiser's only owned state. Created automatically (`openEventsDb`) with
`CREATE TABLE IF NOT EXISTS`, in WAL mode, separate from the Garmin mirror so
that database stays read-only.

### `event`

| Column       | Type                  | Notes                                                |
| ------------ | --------------------- | ---------------------------------------------------- |
| `id`         | INTEGER PK AUTOINCREMENT |                                                   |
| `date`       | TEXT NOT NULL         | Start date (ISO). Point events use this alone.       |
| `end_date`   | TEXT NULL             | If set, the event is a range; must be `>= date`.     |
| `type`       | TEXT NOT NULL         | One of the event types below.                        |
| `label`      | TEXT NOT NULL         | Short display label (≤ 200 chars).                   |
| `notes`      | TEXT NULL             | Optional free text (≤ 2000 chars).                   |
| `created_at` | TEXT NOT NULL         | ISO timestamp set on insert.                         |

Index: `idx_event_date` on `(date)`.

**Event types** (`EVENT_TYPES` in `shared/`): `race`, `injury`, `illness`,
`medication`, `life`, `travel`, `note`.

An event "overlaps" a query window `[from, to]` when it starts on/before `to`
**and** its end (`COALESCE(end_date, date)`) is on/after `from`. Point events
render as marklines; ranged events as shaded bands on the Dashboard,
Performance, and Analysis charts.

---

## Shared contract (`shared/src/index.ts`)

Types and small pure helpers shared by server and web. The important
non-type-only pieces:

### Metric catalog

`METRIC_CATALOG` is the list of daily metrics offered in the Analysis page and
to the AI's `get_metric_series` tool. Each entry is metadata only (key, label,
unit, group, direction-of-good); the matching SQL lives in
`server/src/repositories/metrics.ts` as `METRIC_SQL`. A test
(`catalogKeysMatchSql`) asserts the two never drift apart.

| Key                     | Label                | Group       | Source column(s)                                  |
| ----------------------- | -------------------- | ----------- | ------------------------------------------------- |
| `resting_hr`            | Resting HR           | Health      | `heart_rate.resting_hr`                           |
| `steps`                 | Steps                | Health      | `daily_summary.total_steps`                       |
| `stress`                | Stress               | Health      | `daily_summary.avg_stress_level`                  |
| `sleep_score`           | Sleep score          | Sleep       | `sleep.sleep_score`                               |
| `sleep_hours`           | Sleep duration       | Sleep       | `sleep.total_sleep_seconds / 3600`                |
| `sleep_deep_hours`      | Deep sleep           | Sleep       | `sleep.deep_sleep_seconds / 3600`                 |
| `sleep_rem_hours`       | REM sleep            | Sleep       | `sleep.rem_sleep_seconds / 3600`                  |
| `hrv_nightly`           | HRV (nightly)        | Recovery    | `hrv.last_night_avg`                              |
| `hrv_weekly`            | HRV (weekly)         | Recovery    | `hrv.weekly_avg`                                  |
| `body_battery_high`     | Body battery (peak)  | Recovery    | `daily_summary.body_battery_highest`              |
| `readiness`             | Training readiness   | Recovery    | `training_readiness.score`                        |
| `recovery_time`         | Recovery time        | Recovery    | `training_readiness.recovery_time_min`            |
| `training_load_acute`   | Acute load (7d)      | Training    | `training_status.acute_load`                      |
| `training_load_chronic` | Chronic load (28d)   | Training    | `training_status.chronic_load`                    |
| `acwr`                  | ACWR                 | Training    | `training_status.acwr`                            |
| `vo2max`                | VO2max               | Performance | `COALESCE(training_status.vo2max, max_metrics.vo2max)` |
| `race_5k`               | Predicted 5K         | Performance | `race_predictions.race_5k_s`                      |
| `endurance_score`       | Endurance score      | Performance | `endurance_score.score`                           |
| `hill_score`            | Hill score           | Performance | `hill_score.overall_score`                        |
| `fitness_age`           | Fitness age          | Performance | `fitness_age.fitness_age`                         |

The metric series query only unions/joins the tables actually needed by the
requested keys, so unrelated tables are never scanned.

### Activity-type groups

`ACTIVITY_GROUPS` lets one filter mean "all running" across subtypes. A filter
value is either a raw Garmin type (`running`) or a `group:<key>` value, resolved
by `resolveActivityTypeFilter()` into a `type IN (...)` set. An unknown group key
degrades to "all activities" rather than erroring.

| Group key  | Label        | Member types                                                        |
| ---------- | ------------ | ------------------------------------------------------------------- |
| `running`  | All running  | `running`, `trail_running`, `treadmill_running`, `obstacle_run`     |
| `cycling`  | All cycling  | `cycling`, `indoor_cycling`                                         |
| `swimming` | All swimming | `lap_swimming`, `open_water_swimming`                              |
| `walking`  | All walking  | `walking`, `hiking`                                                |

Adding a Garmin subtype only requires extending the relevant `types` list here.

---

## Coverage caveats

Which metrics are available depends on how long the watch/account has recorded
them and which device produced each activity. Treat every column as sparse and
plan for nulls. Things worth knowing because they look like data but are not:

- `daily_summary.resting_hr` — never populated (use `heart_rate.resting_hr`).
- `daily_summary` stress _duration_ buckets — never populated.
- `body_battery.starting_value` / `ending_value` — never populated.
- `lactate_threshold` speed value — present but an unreliable unit; omitted.
- HR-zone seconds on `activity` — only a minority of activities carry them.

Newer Garmin metrics (HRV, training readiness, race predictions, endurance/hill
scores) only exist from whenever the account/device began recording them, so
their history is shorter than the activity history. Query the relevant table for
its own earliest `date` rather than assuming the full range.

Not mirrored by Garmin-Sync yet, so unavailable (parked): per-second sample
streams, GPS tracks/routes, `activity_lap` (empty), gear/shoe data, body
composition.
