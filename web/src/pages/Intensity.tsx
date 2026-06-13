import { useQuery } from '@tanstack/react-query';
import type * as echarts from 'echarts';
import type { Granularity, IntensityPoint } from '@fitness/shared';
import { activityGroupOptionValue } from '@fitness/shared';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchActivityTypes, fetchIntensity } from '../api';
import Chart from '../Chart';
import RangeControls from '../RangeControls';
import { formatDuration } from '../format';
import { buildTypeOptions } from '../typeOptions';

const ZONE_COLORS = ['#7f8c9b', '#5fa8e6', '#5fce6e', '#e6b95f', '#e66a5f'];
const ZONE_LABELS = ['Z1 warm up', 'Z2 easy', 'Z3 aerobic', 'Z4 threshold', 'Z5 max'];
const GRANULARITIES: Granularity[] = ['week', 'month', 'year'];

function zoneSeconds(p: IntensityPoint): number[] {
  return [p.zone1S, p.zone2S, p.zone3S, p.zone4S, p.zone5S];
}

export default function Intensity() {
  const [searchParams, setSearchParams] = useSearchParams();
  const granularity = (searchParams.get('granularity') as Granularity) ?? 'week';
  const type = searchParams.get('type') ?? activityGroupOptionValue('running');
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const mode = searchParams.get('mode') === 'pct' ? 'pct' : 'hours';

  const setParam = (key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  };
  // Type has a non-empty default, so "all types" must be stored explicitly.
  const setType = (value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('type', value);
      return next;
    });
  };

  const types = useQuery({ queryKey: ['activity-types'], queryFn: fetchActivityTypes });
  const { data, isPending, error } = useQuery({
    queryKey: ['intensity', { granularity, type, from, to }],
    queryFn: () =>
      fetchIntensity({
        granularity,
        type: type || undefined,
        from: from || undefined,
        to: to || undefined,
      }),
    placeholderData: (prev) => prev,
  });

  const option = useMemo<echarts.EChartsOption>(() => {
    const points = data?.points ?? [];
    const dates = points.map((p) => p.date);
    const series: echarts.BarSeriesOption[] = ZONE_LABELS.map((label, zi) => ({
      type: 'bar',
      name: label,
      stack: 'zones',
      itemStyle: { color: ZONE_COLORS[zi] },
      data: points.map((p) => {
        const zones = zoneSeconds(p);
        const seconds = zones[zi] ?? 0;
        if (mode === 'hours') return Math.round((seconds / 3600) * 100) / 100;
        const total = zones.reduce((sum, z) => sum + z, 0);
        return total ? Math.round((seconds / total) * 1000) / 10 : 0;
      }),
    }));

    return {
      backgroundColor: 'transparent',
      title: {
        text: mode === 'hours' ? 'Time in HR zone (hours)' : 'Time in HR zone (% of total)',
        textStyle: { color: '#e6e8eb', fontSize: 13 },
      },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: unknown) => (mode === 'hours' ? `${v} h` : `${v}%`),
      },
      legend: { top: 2, right: 4, textStyle: { color: '#8a93a0', fontSize: 11 } },
      grid: { left: 48, right: 16, top: 36, bottom: 56 },
      xAxis: { type: 'category', data: dates },
      yAxis: {
        type: 'value',
        max: mode === 'pct' ? 100 : undefined,
        splitLine: { lineStyle: { color: '#2a3038' } },
      },
      dataZoom: [
        { type: 'inside', throttle: 50 },
        { type: 'slider', height: 18, bottom: 8 },
      ],
      series,
    };
  }, [data, mode]);

  const totalHours = useMemo(() => {
    if (!data) return null;
    const seconds = data.points.reduce(
      (sum, p) => sum + zoneSeconds(p).reduce((s, z) => s + z, 0),
      0,
    );
    return formatDuration(seconds);
  }, [data]);

  return (
    <>
      <RangeControls
        from={from}
        to={to}
        granularity={granularity}
        granularities={GRANULARITIES}
        setParam={setParam}
        status={totalHours && <span className="status">{totalHours} total</span>}
      >
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">all types</option>
          {buildTypeOptions(types.data).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select value={mode} onChange={(e) => setParam('mode', e.target.value === 'pct' ? 'pct' : '')}>
          <option value="">hours</option>
          <option value="pct">percentage</option>
        </select>
      </RangeControls>

      {isPending && <p className="status">Loading…</p>}
      {error && <p className="status">Failed to load: {(error as Error).message}</p>}
      {data && data.points.length === 0 && (
        <p className="status">No HR-zone data for this filter. Garmin records zones on ~17% of activities.</p>
      )}
      {data && data.points.length > 0 && <Chart option={option} height={460} />}
    </>
  );
}
