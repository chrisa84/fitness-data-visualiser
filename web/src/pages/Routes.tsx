import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchRouteClusters, fetchRouteClusterStatus } from '../api';
import { formatKm, formatPaceFromSecPerKm, formatType } from '../format';

export default function Routes() {
  const clusters = useQuery({ queryKey: ['route-clusters'], queryFn: fetchRouteClusters });
  const backfilling = clusters.data != null && !clusters.data.ready;
  const status = useQuery({
    queryKey: ['route-clusters-status'],
    queryFn: fetchRouteClusterStatus,
    enabled: backfilling,
    refetchInterval: 2000,
  });

  // Refetch clusters once the initial matching backfill completes.
  useEffect(() => {
    if (backfilling && status.data && status.data.processed >= status.data.total && !status.data.running) {
      void clusters.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.data, backfilling]);

  const list = clusters.data?.clusters ?? [];

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Routes</h2>
        <span className="status">
          Activities grouped by the route they follow — repeated routes show effort trends on constant terrain.
        </span>
        {backfilling && (
          <span className="status">
            Matching routes{status.data ? ` — ${status.data.processed} of ${status.data.total}` : ''}…
          </span>
        )}
      </div>
      {clusters.isPending && <p className="status">Loading…</p>}
      {clusters.isError && <p className="status">Failed to load: {(clusters.error as Error).message}</p>}
      {clusters.data && list.length === 0 && !backfilling && (
        <p className="status">No repeated routes found yet — a route shows up here once two activities follow it.</p>
      )}
      {list.length > 0 && (
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Route</th>
              <th style={{ textAlign: 'left' }}>Type</th>
              <th style={{ textAlign: 'right' }}>Efforts</th>
              <th style={{ textAlign: 'right' }}>Distance</th>
              <th style={{ textAlign: 'right' }}>Best pace</th>
              <th style={{ textAlign: 'right' }}>Latest</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link to={`/routes/${c.id}`}>{c.name ?? `Route ${c.id}`}</Link>
                </td>
                <td>{formatType(c.type)}</td>
                <td style={{ textAlign: 'right' }}>{c.count}</td>
                <td style={{ textAlign: 'right' }}>{c.distanceM != null ? formatKm(c.distanceM, 1) : '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  {formatPaceFromSecPerKm(c.bestPaceSecPerKm)}
                </td>
                <td style={{ textAlign: 'right' }}>{c.latestDate ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
