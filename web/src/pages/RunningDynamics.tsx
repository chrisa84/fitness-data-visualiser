import { useQuery } from '@tanstack/react-query';
import type * as echarts from 'echarts';
import type { FormVsPacePoint, Granularity, RunningDynamicsPoint } from '@fitness/shared';
import { activityGroupOptionValue } from '@fitness/shared';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useChartRange } from '../useChartRange';
import { fetchActivityTypes, fetchFormVsPace, fetchRunningDynamics } from '../api';
import Chart from '../Chart';
import RangeControls from '../RangeControls';
import { baseOption, compactOption, line } from '../chartHelpers';
import { buildTypeOptions } from '../typeOptions';

const GRANULARITIES: Granularity[] = ['day', 'week', 'month', 'year'];

// Field → chart metadata. `field` indexes RunningDynamicsPoint.
const CHARTS: {
  field: keyof Omit<RunningDynamicsPoint, 'date'>;
  title: string;
  unit: string;
  color: string;
}[] = [
  { field: 'groundContactMs', title: 'Ground contact time', unit: 'ms', color: '#5fa8e6' },
  { field: 'balanceLeftPct', title: 'L/R balance (left %)', unit: '%', color: '#c98fe6' },
  { field: 'verticalOscillationCm', title: 'Vertical oscillation', unit: 'cm', color: '#5fce6e' },
  { field: 'verticalRatioPct', title: 'Vertical ratio', unit: '%', color: '#e6b95f' },
  { field: 'strideLengthCm', title: 'Stride length', unit: 'cm', color: '#e6896a' },
  { field: 'avgCadence', title: 'Cadence', unit: 'spm', color: '#6ad7c9' },
  { field: 'avgPower', title: 'Run power', unit: 'W', color: '#e66a5f' },
];

// Metrics offered on the form-vs-pace scatter. Raw VO rises naturally with
// speed, so the interesting question is whether the cloud at a given pace
// shifts between years — hence one series per year.
const SCATTER_METRICS: { field: keyof Omit<FormVsPacePoint, 'date' | 'avgSpeedMps' | 'distanceM'>; label: string; unit: string }[] = [
  { field: 'verticalOscillationCm', label: 'Vertical oscillation', unit: 'cm' },
  { field: 'verticalRatioPct', label: 'Vertical ratio', unit: '%' },
  { field: 'avgCadence', label: 'Cadence', unit: 'spm' },
  { field: 'groundContactMs', label: 'Ground contact', unit: 'ms' },
];

const YEAR_COLORS = ['#7f8c9b', '#5fa8e6', '#5fce6e', '#e6b95f', '#e66a5f', '#c98fe6', '#6ad7c9'];

function paceTick(v: number): string {
  const mins = Math.floor(v);
  const secs = Math.round((v - mins) * 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function buildScatterOption(
  points: FormVsPacePoint[],
  metric: (typeof SCATTER_METRICS)[number],
): echarts.EChartsOption {
  const byYear = new Map<string, [number, number, string][]>();
  for (const p of points) {
    const value = p[metric.field];
    if (value == null) continue;
    const paceMin = 1000 / (p.avgSpeedMps * 60);
    if (paceMin > 10) continue; // walks / mis-logged activities
    const year = p.date.slice(0, 4);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push([+paceMin.toFixed(3), value, p.date]);
  }
  const years = [...byYear.keys()].sort();
  return {
    ...baseOption(`${metric.label} (${metric.unit}) vs pace, coloured by year`, []),
    tooltip: {
      trigger: 'item',
      formatter: (d: unknown) => {
        const { value, seriesName } = d as { value: [number, number, string]; seriesName: string };
        return `${value[2]} (${seriesName})<br/>${paceTick(value[0])} /km · ${value[1]} ${metric.unit}`;
      },
    },
    // Value axis (not category); inverse so faster paces sit to the right.
    xAxis: {
      type: 'value',
      inverse: true,
      scale: true,
      name: 'min/km',
      nameLocation: 'end',
      axisLabel: { formatter: paceTick },
      splitLine: { lineStyle: { color: '#2a3038' } },
    },
    yAxis: { type: 'value', scale: true, splitLine: { lineStyle: { color: '#2a3038' } } },
    series: years.map((year, i) => ({
      type: 'scatter' as const,
      name: year,
      data: byYear.get(year)!,
      symbolSize: 7,
      itemStyle: { color: YEAR_COLORS[i % YEAR_COLORS.length], opacity: 0.75 },
    })),
  };
}

export default function RunningDynamics() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { from, to, granularity, type, setParam, setType } =
    useChartRange('week', activityGroupOptionValue('running'));
  const view = searchParams.get('view') === 'scatter' ? 'scatter' : 'trends';
  const metric =
    SCATTER_METRICS.find((m) => m.field === searchParams.get('metric')) ?? SCATTER_METRICS[0]!;

  const types = useQuery({ queryKey: ['activity-types'], queryFn: fetchActivityTypes });
  const { data, isPending, error } = useQuery({
    queryKey: ['running-dynamics', { granularity, type, from, to }],
    queryFn: () =>
      fetchRunningDynamics({
        granularity,
        type: type || undefined,
        from: from || undefined,
        to: to || undefined,
      }),
    placeholderData: (prev) => prev,
    enabled: view === 'trends',
  });

  const scatter = useQuery({
    queryKey: ['form-vs-pace', { type, from, to }],
    queryFn: () =>
      fetchFormVsPace({ type: type || undefined, from: from || undefined, to: to || undefined }),
    placeholderData: (prev) => prev,
    enabled: view === 'scatter',
  });

  const scatterOption = useMemo(
    () => buildScatterOption(scatter.data?.points ?? [], metric),
    [scatter.data, metric],
  );

  const options = useMemo<echarts.EChartsOption[]>(() => {
    const points = data?.points ?? [];
    const dates = points.map((p) => p.date);
    return CHARTS.map((c) => ({
      ...compactOption(`${c.title} (${c.unit})`, dates),
      tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (v == null ? '—' : `${v} ${c.unit}`) },
      // Symbols on, so metrics recorded on only a few activities (balance
      // especially) show as visible points instead of an invisible gap.
      series: [line(c.title, points.map((p) => p[c.field]), c.color, { showSymbol: true, symbolSize: 4 })],
    }));
  }, [data]);

  return (
    <>
      <RangeControls
        from={from}
        to={to}
        granularity={granularity}
        granularities={GRANULARITIES}
        setParam={setParam}
      >
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">all types</option>
          {buildTypeOptions(types.data).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select value={view} onChange={(e) => setParam('view', e.target.value === 'scatter' ? 'scatter' : '')}>
          <option value="">trends</option>
          <option value="scatter">form vs pace</option>
        </select>
        {view === 'scatter' && (
          <select value={metric.field} onChange={(e) => setParam('metric', e.target.value)}>
            {SCATTER_METRICS.map((m) => (
              <option key={m.field} value={m.field}>
                {m.label}
              </option>
            ))}
          </select>
        )}
      </RangeControls>

      {view === 'scatter' && (
        <>
          {scatter.isPending && <p className="status">Loading…</p>}
          {scatter.error && <p className="status">Failed to load: {(scatter.error as Error).message}</p>}
          {scatter.data && scatter.data.points.length === 0 && (
            <p className="status">No per-activity form data for this filter.</p>
          )}
          {scatter.data && scatter.data.points.length > 0 && (
            <>
              <p className="status">
                One point per activity. If a newer year&apos;s cloud sits lower (VO, vertical ratio,
                ground contact) or higher (cadence) at the same pace, form has improved.
              </p>
              <Chart option={scatterOption} height={420} />
            </>
          )}
        </>
      )}

      {view === 'trends' && isPending && <p className="status">Loading…</p>}
      {view === 'trends' && error && <p className="status">Failed to load: {(error as Error).message}</p>}
      {view === 'trends' && data && data.points.length === 0 && (
        <p className="status">
          No running-dynamics data for this filter. These metrics need a dynamics-capable
          sensor (HRM-Pro, Running Dynamics Pod, or a compatible watch).
        </p>
      )}
      {view === 'trends' && data && data.points.length > 0 && (
        <>
          <p className="status">
            Averaged per {granularity}. Balance is recorded on far fewer activities than the
            other metrics, so its line is sparser.
          </p>
          <div className="chart-grid">
            {options.map((option, i) => (
              <Chart key={CHARTS[i]!.field} option={option} height={260} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
