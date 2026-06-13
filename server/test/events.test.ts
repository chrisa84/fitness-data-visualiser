import { describe, expect, it } from 'vitest';
import { openEventsDb } from '../src/db.js';
import {
  createEvent,
  deleteEvent,
  listEvents,
  updateEvent,
} from '../src/repositories/events.js';

function db() {
  return openEventsDb(':memory:');
}

describe('events repository', () => {
  it('creates and lists events ordered by date', () => {
    const d = db();
    createEvent(d, { date: '2025-03-01', type: 'race', label: 'Half marathon' });
    createEvent(d, { date: '2025-01-15', type: 'injury', label: 'Calf strain', endDate: '2025-02-01' });
    const events = listEvents(d);
    expect(events.map((e) => e.label)).toEqual(['Calf strain', 'Half marathon']);
    expect(events[0]).toMatchObject({ type: 'injury', endDate: '2025-02-01', notes: null });
  });

  it('filters to events overlapping a window, including spanning ranges', () => {
    const d = db();
    createEvent(d, { date: '2025-01-15', type: 'injury', label: 'Calf', endDate: '2025-03-15' });
    createEvent(d, { date: '2025-06-01', type: 'race', label: 'Race' });
    // A window inside the injury range must still surface the injury event.
    const events = listEvents(d, '2025-02-01', '2025-02-28');
    expect(events.map((e) => e.label)).toEqual(['Calf']);
  });

  it('updates an event', () => {
    const d = db();
    const created = createEvent(d, { date: '2025-03-01', type: 'race', label: 'Race' });
    const updated = updateEvent(d, created.id, { date: '2025-03-02', type: 'race', label: 'Renamed' });
    expect(updated).toMatchObject({ date: '2025-03-02', label: 'Renamed' });
    expect(updateEvent(d, 999, { date: '2025-01-01', type: 'note', label: 'x' })).toBeNull();
  });

  it('deletes an event', () => {
    const d = db();
    const created = createEvent(d, { date: '2025-03-01', type: 'race', label: 'Race' });
    expect(deleteEvent(d, created.id)).toBe(true);
    expect(deleteEvent(d, created.id)).toBe(false);
    expect(listEvents(d)).toEqual([]);
  });
});
