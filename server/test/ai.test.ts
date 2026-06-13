import { describe, expect, it, vi } from 'vitest';
import { openDb, openEventsDb } from '../src/db.js';
import { runChat, type CompletionClient } from '../src/ai/chat.js';
import { executeTool, runReadOnlySql } from '../src/ai/tools.js';
import { createRecordsDb } from './fixtures.js';

const activities = [
  { activity_id: '1', type: 'running', start_time_local: '2025-01-01 08:00:00', distance_m: 21000, duration_s: 6300, fastest_5k_s: 1400 },
];

function ctx() {
  return { db: openDb(createRecordsDb(activities)), eventsDb: openEventsDb(':memory:') };
}

describe('runReadOnlySql', () => {
  it('runs a SELECT and returns rows', () => {
    const db = openDb(createRecordsDb(activities));
    const result = runReadOnlySql(db, 'SELECT COUNT(*) AS n FROM activity') as { rows: { n: number }[] };
    expect(result.rows[0]!.n).toBe(1);
  });

  it('rejects non-SELECT statements', () => {
    const db = openDb(createRecordsDb(activities));
    expect(() => runReadOnlySql(db, 'DELETE FROM activity')).toThrow(/SELECT/);
    expect(() => runReadOnlySql(db, 'UPDATE activity SET type = "x"')).toThrow(/SELECT/);
  });

  it('rejects multiple statements', () => {
    const db = openDb(createRecordsDb(activities));
    expect(() => runReadOnlySql(db, 'SELECT 1; SELECT 2')).toThrow(/single statement/);
  });

  it('allows a WITH clause', () => {
    const db = openDb(createRecordsDb(activities));
    const result = runReadOnlySql(db, 'WITH t AS (SELECT 1 AS x) SELECT x FROM t') as { rows: unknown[] };
    expect(result.rows).toHaveLength(1);
  });
});

describe('executeTool', () => {
  it('dispatches get_records', () => {
    const records = executeTool('get_records', {}, ctx()) as { key: string }[];
    expect(records.some((r) => r.key === 'fastest_5k')).toBe(true);
  });

  it('dispatches run_sql through the guard', () => {
    expect(() => executeTool('run_sql', { query: 'DROP TABLE activity' }, ctx())).toThrow();
  });

  it('throws on an unknown tool', () => {
    expect(() => executeTool('nope', {}, ctx())).toThrow(/unknown tool/);
  });
});

describe('runChat', () => {
  it('executes tool calls and returns the final answer', async () => {
    const create = vi
      .fn()
      // First call: model asks to run a tool
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{ id: 't1', type: 'function', function: { name: 'get_records', arguments: '{}' } }],
            },
          },
        ],
      })
      // Second call: model answers using the tool result
      .mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'Your half marathon PR is 1:45.' } }],
      });

    const client = { chat: { completions: { create } } } as unknown as CompletionClient;
    const result = await runChat({ client, model: 'test', ctx: ctx(), messages: [{ role: 'user', content: 'records?' }] });

    expect(result.reply).toMatch(/PR/);
    expect(result.toolCalls.map((t) => t.name)).toEqual(['get_records']);
    expect(create).toHaveBeenCalledTimes(2);
    // The system prompt is prepended on the first call.
    expect(create.mock.calls[0]![0].messages[0].role).toBe('system');
  });
});
