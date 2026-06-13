import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { EventType } from '@fitness/shared';
import { EVENT_TYPES } from '@fitness/shared';
import { useState } from 'react';
import { createEvent, deleteEvent } from '../api';
import { EVENT_COLORS, useEvents } from '../events';

const BLANK = { date: '', endDate: '', type: 'race' as EventType, label: '', notes: '' };

export default function Events() {
  const queryClient = useQueryClient();
  const events = useEvents();
  const [form, setForm] = useState(BLANK);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['events'] });

  const create = useMutation({
    mutationFn: () =>
      createEvent({
        date: form.date,
        endDate: form.endDate || undefined,
        type: form.type,
        label: form.label,
        notes: form.notes || undefined,
      }),
    onSuccess: () => {
      setForm(BLANK);
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteEvent(id),
    onSuccess: invalidate,
  });

  const rangeInverted = Boolean(form.endDate) && form.endDate < form.date;
  const canSubmit = Boolean(form.date) && Boolean(form.label) && !rangeInverted;

  return (
    <>
      <p className="status">
        Mark races, injuries, illnesses, medications, and life events. They appear as lines (single
        day) or shaded bands (with an end date) on the Dashboard, Performance, and Analysis charts.
      </p>

      <div className="controls">
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as EventType })}>
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          placeholder="Label (e.g. New job)"
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
          style={{ minWidth: 220 }}
        />
        <label>
          from <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </label>
        <label>
          to <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
        </label>
        <input
          placeholder="Notes (optional)"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
        <button disabled={!canSubmit || create.isPending} onClick={() => create.mutate()}>
          Add event
        </button>
      </div>
      {rangeInverted && <p className="status">End date is before the start date.</p>}
      {create.error && <p className="status">Failed to add: {(create.error as Error).message}</p>}

      {events.data && events.data.length === 0 && <p className="status">No events yet.</p>}
      {events.data && events.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Label</th>
              <th>From</th>
              <th>To</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {events.data.map((e) => (
              <tr key={e.id}>
                <td>
                  <span className="event-dot" style={{ background: EVENT_COLORS[e.type] }} /> {e.type}
                </td>
                <td>{e.label}</td>
                <td>{e.date}</td>
                <td>{e.endDate ?? '—'}</td>
                <td>{e.notes ?? '—'}</td>
                <td>
                  <button onClick={() => remove.mutate(e.id)} disabled={remove.isPending}>
                    delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
