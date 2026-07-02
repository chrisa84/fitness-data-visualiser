import { useQuery } from '@tanstack/react-query';
import type * as echarts from 'echarts';
import type { Granularity } from '@fitness/shared';
import { activityGroupOptionValue } from '@fitness/shared';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useChartRange } from '../useChartRange';
import { fetchActivityTypes, fetchEfficiency } from '../api';
import Chart from '../Chart';
import RangeControls from '../RangeControls';
import { compactOption, line, offScaleMarkers, robustExtent } from '../chartHelpers';
import { formatDuration } from '../format';
import { buildTypeOptions } from '../typeOptions';

const GRANULARITIES: Granularity[] = ['week', 'month', 'year'];

export default function Efficiency() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { from, to, granularity, type, setParam, setType } =
    useChartRange('week', activityGroupOptionValue('running'));
  const hrMin = Number(searchParams.get('hrMin') ?? 145);
  const hrMax = Number(searchParams.get('hrMax') ?? 155);
  // Outlier clipping keeps one stray run from squashing the axis, but hides the
  // stray point entirely — so it is a toggle, on by default.
  const clip = searchParams.get('clip') !== '0';

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
    const efValues = points.map((p) => p.efficiencyFactor);
    const paceValues = points.map((p) => p.paceInBandS);
    const efExtent = clip ? robustExtent(efValues) : {};
    const paceExtent = clip ? robustExtent(paceValues) : {};
    const efOutliers = offScaleMarkers(efValues, efExtent, '#5fce6e');
    const paceOutliers = offScaleMarkers(paceValues, paceExtent, '#5fa8e6');
    const efOption: echarts.EChartsOption = {
      ...compactOption('Efficiency factor (m/min per beat — higher is fitter)', dates),
      yAxis: {
        type: 'value',
        scale: true,
        splitLine: { lineStyle: { color: '#2a3038' } },
        ...efExtent,
      },
      tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (v == null ? '—' : String(v)) },
      series: [
        line('EF', efValues, '#5fce6e', { showSymbol: true, symbolSize: 4 }),
        ...(efOutliers ? [efOutliers] : []),
      ],
    };
    const paceOption: echarts.EChartsOption = {
      ...compactOption(`Pace at HR ${hrMin}–${hrMax} (faster is higher)`, dates),
      // Inverse axis so a faster (smaller) pace trends upward = improvement.
      yAxis: {
        type: 'value',
        inverse: true,
        scale: true,
        axisLabel: { formatter: (v: number) => formatDuration(v) },
        splitLine: { lineStyle: { color: '#2a3038' } },
        ...paceExtent,
      },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: unknown) => (v == null ? '—' : `${formatDuration(v as number)} /km`),
      },
      series: [
        line('Pace', paceValues, '#5fa8e6', { showSymbol: true, symbolSize: 4 }),
        ...(paceOutliers ? [paceOutliers] : []),
      ],
    };
    return { efOption, paceOption };
  }, [data, hrMin, hrMax, clip]);

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
        <label className="status">
          <input
            type="checkbox"
            checked={clip}
            onChange={(e) => setParam('clip', e.target.checked ? '' : '0')}
          />{' '}
          clip outliers
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
