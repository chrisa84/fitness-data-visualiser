import type { Granularity } from '@fitness/shared';
import type { ReactNode } from 'react';
import { DATE_PRESETS, daysAgoIso } from './chartHelpers';

interface Props {
  from: string;
  to: string;
  granularity: Granularity;
  granularities?: Granularity[];
  /** Sets a URL param; empty string clears it (used by the `all` preset). */
  setParam: (key: string, value: string) => void;
  /** Extra controls (e.g. a type filter) rendered before the date controls. */
  children?: ReactNode;
  status?: ReactNode;
}

/** Shared filter row: preset buttons, from/to date inputs, granularity select. */
export default function RangeControls({
  from,
  to,
  granularity,
  granularities = ['day', 'week', 'month', 'year'],
  setParam,
  children,
  status,
}: Props) {
  return (
    <div className="controls">
      {children}
      {DATE_PRESETS.map(({ label, days }) => (
        <button key={label} onClick={() => setParam('from', days ? daysAgoIso(days) : '')}>
          {label}
        </button>
      ))}
      <label>
        from <input type="date" value={from} onChange={(e) => setParam('from', e.target.value)} />
      </label>
      <label>
        to <input type="date" value={to} onChange={(e) => setParam('to', e.target.value)} />
      </label>
      <select value={granularity} onChange={(e) => setParam('granularity', e.target.value)}>
        {granularities.map((g) => (
          <option key={g} value={g}>
            per {g}
          </option>
        ))}
      </select>
      {status}
    </div>
  );
}
