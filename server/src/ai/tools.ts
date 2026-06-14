import type { Database } from 'better-sqlite3';
import type OpenAI from 'openai';
import { METRIC_KEYS, resolveActivityTypeFilter } from '@fitness/shared';
import {
  getActivityVolume,
  listActivities,
} from '../repositories/activities.js';
import { listEvents } from '../repositories/events.js';
import { getMetricSeries } from '../repositories/metrics.js';
import { getPerformanceSeries } from '../repositories/performance.js';
import { getRecords } from '../repositories/records.js';
import { getRunningDynamics } from '../repositories/runningDynamics.js';

export interface ToolContext {
  db: Database; // read-only Garmin database
  eventsDb: Database; // writable events database (read here only)
}

const GRANULARITY = { type: 'string', enum: ['day', 'week', 'month', 'year'] } as const;
const ISO_DATE = { type: 'string', description: 'date as YYYY-MM-DD' } as const;

/** Guards model-generated SQL: single read-only statement only. */
export function runReadOnlySql(db: Database, query: string): unknown {
  const trimmed = query.trim().replace(/;\s*$/, '');
  if (trimmed.includes(';')) throw new Error('only a single statement is allowed');
  if (!/^(select|with)\b/i.test(trimmed)) {
    throw new Error('only SELECT / WITH queries are allowed');
  }
  const rows = db.prepare(trimmed).all() as unknown[];
  if (rows.length > 1000) {
    return { truncated: true, rowCount: rows.length, rows: rows.slice(0, 1000) };
  }
  return { rowCount: rows.length, rows };
}

export const TOOL_DEFINITIONS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_metric_series',
      description:
        'Daily (or bucketed) values for one or more named health/training metrics, aligned by date. Use for trends and comparisons of catalog metrics.',
      parameters: {
        type: 'object',
        properties: {
          keys: { type: 'array', items: { type: 'string', enum: METRIC_KEYS }, description: 'metric keys to fetch' },
          from: ISO_DATE,
          to: ISO_DATE,
          granularity: GRANULARITY,
        },
        required: ['keys'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_activities',
      description: 'List activities with optional type/date/text filters, sorted. Type may be a raw type or a group like "group:running".',
      parameters: {
        type: 'object',
        properties: {
          from: ISO_DATE,
          to: ISO_DATE,
          type: { type: 'string', description: 'activity type or group:<name>' },
          q: { type: 'string', description: 'search activity name' },
          sort: { type: 'string', enum: ['start_time', 'distance', 'duration', 'avg_hr'] },
          order: { type: 'string', enum: ['asc', 'desc'] },
          limit: { type: 'number', description: 'max rows (<=200)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_activity_volume',
      description: 'Aggregated activity volume (count, distance, duration, elevation) per day/week/month/year, optionally filtered by type or group.',
      parameters: {
        type: 'object',
        properties: { from: ISO_DATE, to: ISO_DATE, granularity: GRANULARITY, type: { type: 'string' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_performance_series',
      description: 'Daily performance metrics (VO2max, training load, ACWR, readiness, race predictions, lactate threshold, endurance/hill scores).',
      parameters: {
        type: 'object',
        properties: { from: ISO_DATE, to: ISO_DATE, granularity: GRANULARITY },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_running_dynamics',
      description:
        'Running-form metrics (ground contact time, L/R balance, vertical oscillation/ratio, stride length, cadence, power) averaged per day/week/month/year. Defaults to all running; only dynamics-capable sensor activities carry these.',
      parameters: {
        type: 'object',
        properties: { from: ISO_DATE, to: ISO_DATE, granularity: GRANULARITY, type: { type: 'string' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_records',
      description: 'Personal records derived from activities (fastest 1k/mile/5k, longest run/ride/activity, biggest climb, best VO2max).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_events',
      description: 'User-recorded life events (races, injuries, illness, medication, etc.) optionally overlapping a date window. Useful to correlate with metric changes.',
      parameters: { type: 'object', properties: { from: ISO_DATE, to: ISO_DATE } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_sql',
      description:
        'Run a single read-only SELECT/WITH query against the Garmin SQLite database for anything the other tools cannot express. Tables include activity, daily_summary, sleep, hrv, training_status, training_readiness, race_predictions, etc.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'a single SELECT or WITH statement' } },
        required: ['query'],
      },
    },
  },
];

type Args = Record<string, unknown>;

export function executeTool(name: string, args: Args, ctx: ToolContext): unknown {
  switch (name) {
    case 'get_metric_series':
      return getMetricSeries(
        ctx.db,
        (args.keys as string[]) ?? [],
        (args.from as string) ?? '1970-01-01',
        (args.to as string) ?? '9999-12-31',
        (args.granularity as 'day') ?? 'day',
      );
    case 'list_activities':
      return listActivities(ctx.db, {
        from: (args.from as string) ?? '1970-01-01',
        to: (args.to as string) ?? '9999-12-31',
        types: resolveActivityTypeFilter(args.type as string | undefined),
        q: args.q as string | undefined,
        sort: (args.sort as 'start_time') ?? 'start_time',
        order: (args.order as 'desc') ?? 'desc',
        limit: Math.min(Number(args.limit) || 50, 200),
        offset: 0,
      });
    case 'get_activity_volume':
      return getActivityVolume(
        ctx.db,
        (args.from as string) ?? '1970-01-01',
        (args.to as string) ?? '9999-12-31',
        (args.granularity as 'week') ?? 'week',
        resolveActivityTypeFilter(args.type as string | undefined),
      );
    case 'get_performance_series':
      return getPerformanceSeries(
        ctx.db,
        (args.from as string) ?? '1970-01-01',
        (args.to as string) ?? '9999-12-31',
        (args.granularity as 'day') ?? 'day',
      );
    case 'get_running_dynamics':
      return getRunningDynamics(
        ctx.db,
        (args.from as string) ?? '1970-01-01',
        (args.to as string) ?? '9999-12-31',
        (args.granularity as 'week') ?? 'week',
        resolveActivityTypeFilter((args.type as string | undefined) ?? 'group:running'),
      );
    case 'get_records':
      return getRecords(ctx.db);
    case 'list_events':
      return listEvents(ctx.eventsDb, args.from as string | undefined, args.to as string | undefined);
    case 'run_sql':
      return runReadOnlySql(ctx.db, String(args.query ?? ''));
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
