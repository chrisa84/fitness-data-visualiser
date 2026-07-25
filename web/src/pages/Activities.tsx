import { useQuery } from '@tanstack/react-query';
import type { ActivitySortKey } from '@fitness/shared';
import { ACTIVITY_SORT_KEYS } from '@fitness/shared';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchActivities, fetchActivityTypes } from '../api';
import { formatDateTime, formatDuration, formatKm, formatNumber, formatPace, formatType } from '../format';
import TagChip from '../TagChip';
import { tagsById, useTags } from '../tags';
import { buildTypeOptions } from '../typeOptions';

const PAGE_SIZE = 50;

/** `?tags=1,2` ⇄ number[]. Invalid entries are ignored so a stale URL still loads. */
function parseTagParam(raw: string): number[] {
  return raw
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export default function Activities() {
  const [searchParams, setSearchParams] = useSearchParams();
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const type = searchParams.get('type') ?? '';
  const q = searchParams.get('q') ?? '';
  const selectedTagIds = parseTagParam(searchParams.get('tags') ?? '');
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

  const toggleTag = (id: number) => {
    const next = selectedTagIds.includes(id)
      ? selectedTagIds.filter((t) => t !== id)
      : [...selectedTagIds, id];
    setParam('tags', next.join(','));
  };

  const types = useQuery({ queryKey: ['activity-types'], queryFn: fetchActivityTypes });
  const tags = useTags();
  const tagLookup = tagsById(tags.data);
  const tagKey = selectedTagIds.join(',');
  const { data, isPending, error } = useQuery({
    queryKey: ['activities', { from, to, type, q, tags: tagKey, sort, order, page }],
    queryFn: () =>
      fetchActivities({
        from: from || undefined,
        to: to || undefined,
        type: type || undefined,
        q: q || undefined,
        tagIds: selectedTagIds,
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

      {tags.data && tags.data.length > 0 && (
        <div className="controls">
          <span className="status">tags:</span>
          <span className="tag-list">
            {tags.data.map((tag) => (
              <TagChip
                key={tag.id}
                tag={tag}
                selected={selectedTagIds.includes(tag.id)}
                onClick={() => toggleTag(tag.id)}
                title={`${tag.name} · ${tag.activityCount} activities`}
              />
            ))}
          </span>
          {selectedTagIds.length > 0 && (
            <>
              <button onClick={() => setParam('tags', '')}>clear</button>
              {selectedTagIds.length > 1 && (
                <span className="status">showing activities with all {selectedTagIds.length} tags</span>
              )}
            </>
          )}
        </div>
      )}

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
                {tags.data && tags.data.length > 0 && <th>Tags</th>}
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
                  {tags.data && tags.data.length > 0 && (
                    <td>
                      <span className="tag-list">
                        {a.tagIds
                          .map((id) => tagLookup.get(id))
                          .filter((t): t is NonNullable<typeof t> => t != null)
                          .map((t) => (
                            <TagChip key={t.id} tag={t} />
                          ))}
                      </span>
                    </td>
                  )}
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
