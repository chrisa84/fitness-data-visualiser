import { useQuery } from '@tanstack/react-query';
import type { ActivitySortKey } from '@fitness/shared';
import { ACTIVITY_SORT_KEYS } from '@fitness/shared';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchActivities, fetchActivityTypes } from '../api';
import { formatDateTime, formatDuration, formatKm, formatNumber, formatPace, formatType } from '../format';
import { buildTypeOptions } from '../typeOptions';

const PAGE_SIZE = 50;

export default function Activities() {
  const [searchParams, setSearchParams] = useSearchParams();
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const type = searchParams.get('type') ?? '';
  const q = searchParams.get('q') ?? '';
  const sort = (searchParams.get('sort') as ActivitySortKey) ?? 'start_time';
  const order = (searchParams.get('order') as 'asc' | 'desc') ?? 'desc';
  const page = Number(searchParams.get('page') ?? '0');

  const setParam = (key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      return next;
    });
  };

  const types = useQuery({ queryKey: ['activity-types'], queryFn: fetchActivityTypes });
  const { data, isPending, error } = useQuery({
    queryKey: ['activities', { from, to, type, q, sort, order, page }],
    queryFn: () =>
      fetchActivities({
        from: from || undefined,
        to: to || undefined,
        type: type || undefined,
        q: q || undefined,
        sort,
        order,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    placeholderData: (prev) => prev,
  });

  const toggleSort = (key: ActivitySortKey) => {
    if (sort === key) setParam('order', order === 'desc' ? 'asc' : 'desc');
    else {
      setParam('sort', key);
    }
  };

  const sortIndicator = (key: ActivitySortKey) =>
    sort === key ? (order === 'desc' ? ' ▼' : ' ▲') : '';

  const pageCount = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <>
      <div className="controls">
        <input
          type="search"
          placeholder="Search name…"
          defaultValue={q}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setParam('q', e.currentTarget.value);
          }}
        />
        <select value={type} onChange={(e) => setParam('type', e.target.value)}>
          <option value="">all types</option>
          {buildTypeOptions(types.data).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <label>
          from <input type="date" value={from} onChange={(e) => setParam('from', e.target.value)} />
        </label>
        <label>
          to <input type="date" value={to} onChange={(e) => setParam('to', e.target.value)} />
        </label>
        {data && <span className="status">{data.total} activities</span>}
      </div>

      {isPending && <p className="status">Loading…</p>}
      {error && <p className="status">Failed to load: {(error as Error).message}</p>}

      {data && (
        <>
          <table>
            <thead>
              <tr>
                <th className="sortable" onClick={() => toggleSort('start_time')}>
                  Date{sortIndicator('start_time')}
                </th>
                <th>Name</th>
                <th>Type</th>
                <th className="sortable num" onClick={() => toggleSort('distance')}>
                  Distance{sortIndicator('distance')}
                </th>
                <th className="sortable num" onClick={() => toggleSort('duration')}>
                  Duration{sortIndicator('duration')}
                </th>
                <th className="num">Pace</th>
                <th className="sortable num" onClick={() => toggleSort('avg_hr')}>
                  Avg HR{sortIndicator('avg_hr')}
                </th>
                <th className="num">Elev</th>
                <th className="num">Load</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((a) => (
                <tr key={a.activityId}>
                  <td>{formatDateTime(a.startTimeLocal)}</td>
                  <td>
                    <Link to={`/activities/${a.activityId}`}>{a.name ?? '(unnamed)'}</Link>
                  </td>
                  <td>{formatType(a.type)}</td>
                  <td className="num">{a.distanceM ? formatKm(a.distanceM) : '—'}</td>
                  <td className="num">{formatDuration(a.durationS)}</td>
                  <td className="num">
                    {a.type?.includes('running') ? formatPace(a.avgSpeedMps) : '—'}
                  </td>
                  <td className="num">{formatNumber(a.avgHr)}</td>
                  <td className="num">{a.elevationGainM ? formatNumber(a.elevationGainM, ' m') : '—'}</td>
                  <td className="num">{formatNumber(a.trainingLoad)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pageCount > 1 && (
            <div className="controls">
              <button disabled={page <= 0} onClick={() => setParam('page', String(page - 1))}>
                ← prev
              </button>
              <span className="status">
                page {page + 1} of {pageCount}
              </span>
              <button
                disabled={page >= pageCount - 1}
                onClick={() => setParam('page', String(page + 1))}
              >
                next →
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
