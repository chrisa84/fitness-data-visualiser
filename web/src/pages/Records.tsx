import { useQuery } from '@tanstack/react-query';
import type { PersonalRecord } from '@fitness/shared';
import { Link } from 'react-router-dom';
import { fetchRecords } from '../api';
import { formatDateTime, formatDuration, formatKm } from '../format';

function formatRecord(r: PersonalRecord): string {
  if (r.format === 'duration') return formatDuration(r.value);
  if (r.format === 'distance_km') return formatKm(r.value, 1);
  return `${Math.round(r.value)}${r.unit ? ` ${r.unit}` : ''}`;
}

export default function Records() {
  const { data, isPending, error } = useQuery({ queryKey: ['records'], queryFn: fetchRecords });

  return (
    <>
      <p className="status">Personal records derived from your activity history.</p>
      {isPending && <p className="status">Loading…</p>}
      {error && <p className="status">Failed to load: {(error as Error).message}</p>}
      {data && (
        <div className="stat-grid">
          {data.map((r) => (
            <div key={r.key} className="stat">
              <div className="stat-label">{r.label}</div>
              <div className="stat-value">{formatRecord(r)}</div>
              {r.activityId && (
                <div className="stat-sub">
                  <Link to={`/activities/${r.activityId}`}>{formatDateTime(r.date)}</Link>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
