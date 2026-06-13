import type { Database } from 'better-sqlite3';
import type { CalendarEvent, EventInput, EventType } from '@fitness/shared';

function mapEvent(r: Record<string, unknown>): CalendarEvent {
  return {
    id: r.id as number,
    date: r.date as string,
    endDate: (r.end_date as string | null) ?? null,
    type: r.type as EventType,
    label: r.label as string,
    notes: (r.notes as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

export function listEvents(db: Database, from?: string, to?: string): CalendarEvent[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  // An event overlaps the window if it starts on/before `to` and its end
  // (or start, for point events) is on/after `from`.
  if (to) {
    where.push('date <= @to');
    params.to = to;
  }
  if (from) {
    where.push('COALESCE(end_date, date) >= @from');
    params.from = from;
  }
  const sql = `SELECT * FROM event ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY date`;
  return (db.prepare(sql).all(params) as Record<string, unknown>[]).map(mapEvent);
}

export function getEvent(db: Database, id: number): CalendarEvent | null {
  const row = db.prepare('SELECT * FROM event WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapEvent(row) : null;
}

export function createEvent(db: Database, input: EventInput): CalendarEvent {
  const info = db
    .prepare(
      `INSERT INTO event (date, end_date, type, label, notes, created_at)
       VALUES (@date, @endDate, @type, @label, @notes, @createdAt)`,
    )
    .run({
      date: input.date,
      endDate: input.endDate ?? null,
      type: input.type,
      label: input.label,
      notes: input.notes ?? null,
      createdAt: new Date().toISOString(),
    });
  return getEvent(db, Number(info.lastInsertRowid))!;
}

export function updateEvent(db: Database, id: number, input: EventInput): CalendarEvent | null {
  const existing = getEvent(db, id);
  if (!existing) return null;
  db.prepare(
    `UPDATE event SET date = @date, end_date = @endDate, type = @type,
                      label = @label, notes = @notes
     WHERE id = @id`,
  ).run({
    id,
    date: input.date,
    endDate: input.endDate ?? null,
    type: input.type,
    label: input.label,
    notes: input.notes ?? null,
  });
  return getEvent(db, id);
}

export function deleteEvent(db: Database, id: number): boolean {
  return db.prepare('DELETE FROM event WHERE id = ?').run(id).changes > 0;
}
