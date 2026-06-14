import { useQuery } from '@tanstack/react-query';
import type * as echarts from 'echarts';
import type { Granularity } from '@fitness/shared';
import { activityGroupOptionValue } from '@fitness/shared';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchActivityTypes, fetchEfficiency } from '../api';
import Chart from '../Chart';
import RangeControls from '../RangeControls';
import { baseOption, line, robustExtent } from '../chartHelpers';
import { formatDuration } from '../format';
import { buildTypeOptions } from '../typeOptions';

const GRANULARITIES: Granularity[] = ['week', 'month', 'year'];

export default function Efficiency() {
  const [searchParams, setSearchParams] = useSearchParams();
  const granularity = (searchParams.get('granularity') as Granularity) ?? 'week';
  const type = searchParams.get('type') ?? activityGroupOptionValue('running');
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const hrMin = Number(searchParams.get('hrMin') ?? 145);
  const hrMax = Number(searchParams.get('hrMax') ?? 155);

  const setParam = (key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  };
  const setType = (value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('type', value);
      return next;
    });
  };

  const types = useQuery({ queryKey: ['activity-types'], queryFn: fetchActivityTypes });
  const { data, isPending, error } = useQuery({
    queryKey: ['efficiency', { granularity, type, from, to, hrMin, hrMax }],
    queryFn: () =>
      fetchEfficiency({
        granularity,
        type: type || undefined,
        from: from || undefined,
        to: to || undefined,
        hrMin,
        hrMax,
      }),
    placeholderData: (prev) => prev,
  });

  const { efOption, paceOption } = useMemo(() => {
    const points = data?.points ?? [];
    const dates = points.map((p) => p.date);
    const efOption: echarts.EChartsOption = {
      ...baseOption('Efficiency factor (m/min per beat — higher is fitter)', dates),
      legend: { show: false },
      grid: { left: 48, right: 16, top: 36, bottom: 48 },
      yAxis: {
        type: 'value',
        scale: true,
        splitLine: { lineStyle: { color: '#2a3038' } },
        ...robustExtent(points.map((p) => p.efficiencyFactor)),
      },
      tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (v == null ? '—' : String(v)) },
      series: [line('EF', points.map((p) => p.efficiencyFactor), '#5fce6e', { showSymbol: true, symbolSize: 4 })],
    };
    const paceOption: echarts.EChartsOption = {
      ...baseOption(`Pace at HR ${hrMin}–${hrMax} (faster is higher)`, dates),
      legend: { show: false },
      grid: { left: 56, right: 16, top: 36, bottom: 48 },
      // Inverse axis so a faster (smaller) pace trends upward = improvement.
      yAxis: {
        type: 'value',
        inverse: true,
        scale: true,
        axisLabel: { formatter: (v: number) => formatDuration(v) },
        splitLine: { lineStyle: { color: '#2a3038' } },
        ...robustExtent(points.map((p) => p.paceInBandS)),
      },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: unknown) => (v == null ? '—' : `${formatDuration(v as number)} /km`),
      },
      series: [line('Pace', points.map((p) => p.paceInBandS), '#5fa8e6', { showSymbol: true, symbolSize: 4 })],
    };
    return { efOption, paceOption };
  }, [data, hrMin, hrMax]);

  const bandRuns = useMemo(
    () => (data?.points ?? []).reduce((sum, p) => sum + p.runsInBand, 0),
    [data],
  );

  return (
    <>
      <RangeControls
        from={from}
        to={to}
        granularity={granularity}
        granularities={GRANULARITIES}
        setParam={setParam}
        status={data && <span className="status">{bandRuns} runs in HR band</span>}
      >
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">all types</option>
          {buildTypeOptions(types.data).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <label className="status">
          HR band{' '}
          <input
            type="number"
            value={hrMin}
            min={60}
            max={220}
            style={{ width: 56 }}
            onChange={(e) => setParam('hrMin', e.target.value)}
          />
          {' – '}
          <input
            type="number"
            value={hrMax}
            min={60}
            max={220}
            style={{ width: 56 }}
            onChange={(e) => setParam('hrMax', e.target.value)}
          />
        </label>
      </RangeControls>

      {isPending && <p className="status">Loading…</p>}
      {error && <p className="status">Failed to load: {(error as Error).message}</p>}
      {data && data.points.length === 0 && <p className="status">No runs with heart rate for this filter.</p>}
      {data && data.points.length > 0 && (
        <>
          <p className="status">
            Efficiency factor is speed per heartbeat across all runs in each bucket. The pace chart
            holds effort roughly constant by only counting runs whose average HR fell in your band,
            so a rising pace line is fitness rather than effort.
          </p>
          <div className="chart-grid">
            <Chart option={efOption} height={300} />
            <Chart option={paceOption} height={300} />
          </div>
        </>
      )}
    </>
  );
}
