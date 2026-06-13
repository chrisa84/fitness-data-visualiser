import type { Database } from 'better-sqlite3';
import type { PersonalRecord } from '@fitness/shared';
import { resolveActivityTypeFilter } from '@fitness/shared';
import { typeFilterClause } from './activities.js';

interface RecordSpec {
  key: string;
  label: string;
  unit: string;
  column: string;
  direction: 'min' | 'max';
  format?: 'duration' | 'distance_km';
  group?: string;
}

// Personal records derived from the activity table. "Fastest" records use the
// pre-computed best-split columns Garmin provides per activity.
const RECORD_SPECS: RecordSpec[] = [
  { key: 'fastest_1k', label: 'Fastest 1 km', unit: '', column: 'fastest_km_s', direction: 'min', format: 'duration' },
  { key: 'fastest_mile', label: 'Fastest mile', unit: '', column: 'fastest_mile_s', direction: 'min', format: 'duration' },
  { key: 'fastest_5k', label: 'Fastest 5 km', unit: '', column: 'fastest_5k_s', direction: 'min', format: 'duration' },
  { key: 'longest_run', label: 'Longest run', unit: '', column: 'distance_m', direction: 'max', format: 'distance_km', group: 'running' },
  { key: 'longest_ride', label: 'Longest ride', unit: '', column: 'distance_m', direction: 'max', format: 'distance_km', group: 'cycling' },
  { key: 'longest_activity', label: 'Longest activity', unit: '', column: 'duration_s', direction: 'max', format: 'duration' },
  { key: 'biggest_climb', label: 'Biggest climb', unit: 'm', column: 'elevation_gain_m', direction: 'max' },
  { key: 'highest_vo2max', label: 'Highest VO2max (activity)', unit: '', column: 'vo2max', direction: 'max' },
];

export function getRecords(db: Database): PersonalRecord[] {
  const records: PersonalRecord[] = [];
  for (const spec of RECORD_SPECS) {
    const params: Record<string, unknown> = {};
    const where = [`${spec.column} IS NOT NULL`, `${spec.column} > 0`];
    const typeClause = typeFilterClause(
      spec.group ? resolveActivityTypeFilter(`group:${spec.group}`) : undefined,
      params,
    );
    if (typeClause) where.push(typeClause);

    const row = db
      .prepare(
        `SELECT ${spec.column} AS value, activity_id, start_time_local
         FROM activity
         WHERE ${where.join(' AND ')}
         ORDER BY ${spec.column} ${spec.direction === 'min' ? 'ASC' : 'DESC'}
         LIMIT 1`,
      )
      .get(params) as { value: number; activity_id: string; start_time_local: string | null } | undefined;

    if (row) {
      records.push({
        key: spec.key,
        label: spec.label,
        value: row.value,
        unit: spec.unit,
        format: spec.format,
        activityId: row.activity_id,
        date: row.start_time_local,
      });
    }
  }
  return records;
}
