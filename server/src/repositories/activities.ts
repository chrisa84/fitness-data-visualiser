import type { Database } from 'better-sqlite3';
import type {
  ActivityDetail,
  ActivityListItem,
  ActivityListResponse,
  ActivitySample,
  ActivitySortKey,
  ActivitySplit,
  ActivityTypeCount,
  Granularity,
  VolumePoint,
} from '@fitness/shared';

const LIST_COLUMNS = `
  activity_id, name, type, start_time_local, distance_m, duration_s,
  moving_duration_s, avg_hr, max_hr, avg_speed_mps, elevation_gain_m,
  calories, aerobic_te, anaerobic_te, training_load
`;

const SORT_COLUMN: Record<ActivitySortKey, string> = {
  start_time: 'start_time_local',
  distance: 'distance_m',
  duration: 'duration_s',
  avg_hr: 'avg_hr',
};

export interface ListActivitiesOptions {
  from: string;
  to: string;
  types?: string[];
  q?: string;
  sort: ActivitySortKey;
  order: 'asc' | 'desc';
  limit: number;
  offset: number;
}

/**
 * Builds a `type IN (@t0, @t1, ...)` clause, writing the bound values into
 * `params`. Returns an empty string when there is nothing to filter on.
 */
export function typeFilterClause(types: string[] | undefined, params: Record<string, unknown>): string {
  if (!types || types.length === 0) return '';
  const placeholders = types.map((t, i) => {
    params[`type${i}`] = t;
    return `@type${i}`;
  });
  return `type IN (${placeholders.join(', ')})`;
}

function mapListItem(r: Record<string, unknown>): ActivityListItem {
  return {
    activityId: r.activity_id as string,
    name: r.name as string | null,
    type: r.type as string | null,
    startTimeLocal: r.start_time_local as string | null,
    distanceM: r.distance_m as number | null,
    durationS: r.duration_s as number | null,
    movingDurationS: r.moving_duration_s as number | null,
    avgHr: r.avg_hr as number | null,
    maxHr: r.max_hr as number | null,
    avgSpeedMps: r.avg_speed_mps as number | null,
    elevationGainM: r.elevation_gain_m as number | null,
    calories: r.calories as number | null,
    aerobicTe: r.aerobic_te as number | null,
    anaerobicTe: r.anaerobic_te as number | null,
    trainingLoad: r.training_load as number | null,
  };
}

export function listActivities(db: Database, opts: ListActivitiesOptions): ActivityListResponse {
  const where: string[] = ['date(start_time_local) BETWEEN @from AND @to'];
  const params: Record<string, unknown> = { from: opts.from, to: opts.to };
  const typeClause = typeFilterClause(opts.types, params);
  if (typeClause) where.push(typeClause);
  if (opts.q) {
    where.push("name LIKE @q ESCAPE '\\' COLLATE NOCASE");
    params.q = `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  }
  const whereSql = where.join(' AND ');

  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM activity WHERE ${whereSql}`)
    .get(params) as { total: number };

  const rows = db
    .prepare(
      `SELECT ${LIST_COLUMNS} FROM activity
       WHERE ${whereSql}
       ORDER BY ${SORT_COLUMN[opts.sort]} ${opts.order === 'asc' ? 'ASC' : 'DESC'} NULLS LAST
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: opts.limit, offset: opts.offset }) as Record<string, unknown>[];

  return {
    total,
    limit: opts.limit,
    offset: opts.offset,
    items: rows.map(mapListItem),
  };
}

export function getActivityTypes(db: Database): ActivityTypeCount[] {
  return db
    .prepare(
      `SELECT type, COUNT(*) AS count FROM activity
       WHERE type IS NOT NULL
       GROUP BY type ORDER BY count DESC`,
    )
    .all() as ActivityTypeCount[];
}

export function getActivity(db: Database, activityId: string): ActivityDetail | null {
  const r = db.prepare('SELECT * FROM activity WHERE activity_id = ?').get(activityId) as
    | Record<string, unknown>
    | undefined;
  if (!r) return null;

  const splits = db
    .prepare(
      `SELECT split_index, split_type, distance_m, duration_s, moving_duration_s,
              avg_hr, max_hr, avg_speed_mps, avg_cadence, avg_power, calories,
              elevation_gain_m, elevation_loss_m, ground_contact_ms, vertical_oscillation_cm
       FROM activity_split WHERE activity_id = ? ORDER BY split_index`,
    )
    .all(activityId) as Record<string, unknown>[];

  return {
    ...mapListItem(r),
    startTime: r.start_time as string | null,
    elapsedDurationS: r.elapsed_duration_s as number | null,
    avgCadence: r.avg_cadence as number | null,
    maxCadence: r.max_cadence as number | null,
    avgPower: r.avg_power as number | null,
    maxPower: r.max_power as number | null,
    normPower: r.norm_power as number | null,
    maxSpeedMps: r.max_speed_mps as number | null,
    elevationLossM: r.elevation_loss_m as number | null,
    vo2max: r.vo2max as number | null,
    activitySteps: r.activity_steps as number | null,
    bodyBatteryDelta: r.body_battery_delta as number | null,
    avgRespirationRate: r.avg_respiration_rate as number | null,
    hrZone1S: r.hr_zone_1_s as number | null,
    hrZone2S: r.hr_zone_2_s as number | null,
    hrZone3S: r.hr_zone_3_s as number | null,
    hrZone4S: r.hr_zone_4_s as number | null,
    hrZone5S: r.hr_zone_5_s as number | null,
    fastestKmS: r.fastest_km_s as number | null,
    fastest5kS: r.fastest_5k_s as number | null,
    tempAvgC: r.temp_avg_c as number | null,
    waterEstimatedMl: r.water_estimated_ml as number | null,
    staminaStart: r.stamina_start as number | null,
    staminaEnd: r.stamina_end as number | null,
    staminaMin: r.stamina_min as number | null,
    groundContactMs: r.ground_contact_ms as number | null,
    groundContactBalanceLeft: r.ground_contact_balance_left as number | null,
    verticalOscillationCm: r.vertical_oscillation_cm as number | null,
    verticalRatioPct: r.vertical_ratio_pct as number | null,
    strideLengthCm: r.stride_length_cm as number | null,
    splits: splits.map(
      (s): ActivitySplit => ({
        splitIndex: s.split_index as number,
        splitType: s.split_type as string | null,
        distanceM: s.distance_m as number | null,
        durationS: s.duration_s as number | null,
        movingDurationS: s.moving_duration_s as number | null,
        avgHr: s.avg_hr as number | null,
        maxHr: s.max_hr as number | null,
        avgSpeedMps: s.avg_speed_mps as number | null,
        avgCadence: s.avg_cadence as number | null,
        avgPower: s.avg_power as number | null,
        calories: s.calories as number | null,
        elevationGainM: s.elevation_gain_m as number | null,
        elevationLossM: s.elevation_loss_m as number | null,
        groundContactMs: s.ground_contact_ms as number | null,
        verticalOscillationCm: s.vertical_oscillation_cm as number | null,
      }),
    ),
  };
}

export function getActivitySamples(db: Database, activityId: string): ActivitySample[] {
  const rows = db
    .prepare(
      `SELECT sample_index, distance_m, heart_rate, speed_mps,
              cadence, power_w, altitude_m, lat, lon, respiration_rate,
              ground_contact_ms, ground_contact_balance_left,
              vertical_oscillation_cm, vertical_ratio_pct, stride_length_cm
       FROM activity_sample
       WHERE activity_id = ?
       ORDER BY sample_index ASC`,
    )
    .all(activityId) as Record<string, unknown>[];

  return rows.map(
    (r): ActivitySample => ({
      sampleIndex: r.sample_index as number,
      distanceM: r.distance_m as number | null,
      heartRate: r.heart_rate as number | null,
      speedMps: r.speed_mps as number | null,
      cadence: r.cadence as number | null,
      powerW: r.power_w as number | null,
      altitudeM: r.altitude_m as number | null,
      lat: r.lat as number | null,
      lon: r.lon as number | null,
      respirationRate: r.respiration_rate as number | null,
      groundContactMs: r.ground_contact_ms as number | null,
      groundContactBalanceLeft: r.ground_contact_balance_left as number | null,
      verticalOscillationCm: r.vertical_oscillation_cm as number | null,
      verticalRatioPct: r.vertical_ratio_pct as number | null,
      strideLengthCm: r.stride_length_cm as number | null,
    }),
  );
}

const VOLUME_BUCKET: Record<Granularity, string> = {
  day: 'date(start_time_local)',
  week: "strftime('%Y-%W', start_time_local)",
  month: "strftime('%Y-%m', start_time_local)",
  year: "strftime('%Y', start_time_local)",
};

export function getActivityVolume(
  db: Database,
  from: string,
  to: string,
  granularity: Granularity,
  types?: string[],
): VolumePoint[] {
  const params: Record<string, unknown> = { from, to };
  const typeClause = typeFilterClause(types, params);
  const rows = db
    .prepare(
      `SELECT MIN(date(start_time_local))               AS date,
              COUNT(*)                                  AS count,
              ROUND(COALESCE(SUM(distance_m), 0), 1)    AS distanceM,
              ROUND(COALESCE(SUM(duration_s), 0), 1)    AS durationS,
              ROUND(COALESCE(SUM(elevation_gain_m), 0), 1) AS elevationGainM
       FROM activity
       WHERE date(start_time_local) BETWEEN @from AND @to ${typeClause ? `AND ${typeClause}` : ''}
       GROUP BY ${VOLUME_BUCKET[granularity]}
       ORDER BY date`,
    )
    .all(params) as VolumePoint[];
  return rows;
}
