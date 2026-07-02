import { useQuery } from '@tanstack/react-query';
import type { Granularity } from '@fitness/shared';
import { useCallback } from 'react';
import { useChartRange } from '../useChartRange';
import { activityGroupOptionValue } from '@fitness/shared';
import { fetchActivityTypes, fetchVolume } from '../api';
import BarChart from '../BarChart';
import { formatDuration } from '../format';
import { buildTypeOptions, labelForTypeValue } from '../typeOptions';

const GRANULARITY_OPTIONS: Granularity[] = ['week', 'month', 'year'];
type Metric = 'distance' | 'duration' | 'elevation' | 'count';
const METRICS: { key: Metric; label: string; unit: string }[] = [
  { key: 'distance', label: 'Distance', unit: 'km' },
  { key: 'duration', label: 'Duration', unit: 'h' },
  { key: 'elevation', label: 'Elevation gain', unit: 'm' },
  { key: 'count', label: 'Activity count', unit: '' },
];

export default function Volume() {
  const { from, to, granularity, type, setParam, setType, searchParams } =
    useChartRange('week', activityGroupOptionValue('running'));
  const metric = (searchParams.get('metric') as Metric) ?? 'distance';

  const types = useQuery({ queryKey: ['activity-types'], queryFn: fetchActivityTypes });
  const { data, isPending, error } = useQuery({
    queryKey: ['volume', { granularity, type, from, to }],
    queryFn: () =>
      fetchVolume({
        granularity,
        type: type || undefined,
        from: from || undefined,
        to: to || undefined,
      }),
    placeholderData: (prev) => prev,
  });

  const metricDef = METRICS.find((m) => m.key === metric)!;
  const points = data?.points ?? [];
  const values = points.map((p) => {
    switch (metric) {
      case 'distance':
        return Math.round(p.distanceM / 100) / 10;
      case 'duration':
        return Math.round((p.durationS / 3600) * 10) / 10;
      case 'elevation':
        return Math.round(p.elevationGainM);
      case 'count':
        return p.count;
    }
  });

  const tooltipExtra = useCallback(
    (i: number) => {
      const p = points[i];
      if (!p) return [];
      return [
        `${p.count} activities`,
        `${(p.distanceM / 1000).toFixed(1)} km`,
        formatDuration(p.durationS),
        `${Math.round(p.elevationGainM)} m gain`,
      ];
    },
    [points],
  );

  return (
    <>
      <div className="controls">
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">all types</option>
          {buildTypeOptions(types.data).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select value={granularity} onChange={(e) => setParam('granularity', e.target.value)}>
          {GRANULARITY_OPTIONS.map((g) => (
            <option key={g} value={g}>
              per {g}
            </option>
          ))}
        </select>
        <select value={metric} onChange={(e) => setParam('metric', e.target.value)}>
          {METRICS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
        <label>
          from <input type="date" value={from} onChange={(e) => setParam('from', e.target.value)} />
        </label>
        <label>
          to <input type="date" value={to} onChange={(e) => setParam('to', e.target.value)} />
        </label>
      </div>

      {isPending && <p className="status">Loading…</p>}
      {error && <p className="status">Failed to load: {(error as Error).message}</p>}
      {data && (
        <BarChart
          title={`${metricDef.label}${type ? ` — ${labelForTypeValue(type)}` : ''} per ${granularity}`}
          unit={metricDef.unit}
          categories={points.map((p) => p.date)}
          values={values}
          tooltipExtra={tooltipExtra}
        />
      )}
    </>
  );
}
