import { useQuery } from '@tanstack/react-query';
import type * as echarts from 'echarts';
import type { Granularity, RunningDynamicsPoint } from '@fitness/shared';
import { activityGroupOptionValue } from '@fitness/shared';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useChartRange } from '../useChartRange';
import { fetchActivityTypes, fetchRunningDynamics } from '../api';
import Chart from '../Chart';
import RangeControls from '../RangeControls';
import { baseOption, line } from '../chartHelpers';
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

export default function RunningDynamics() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { from, to, granularity, setParam } = useChartRange('week');
  const type = searchParams.get('type') ?? activityGroupOptionValue('running');

  // Type has a non-empty default, so an explicit choice (incl. all) is stored.
  const setType = (value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('type', value);
      return next;
    });
  };

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
  });

  const options = useMemo<echarts.EChartsOption[]>(() => {
    const points = data?.points ?? [];
    const dates = points.map((p) => p.date);
    return CHARTS.map((c) => ({
      ...baseOption(`${c.title} (${c.unit})`, dates),
      legend: { show: false },
      grid: { left: 48, right: 16, top: 36, bottom: 48 },
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
      </RangeControls>

      {isPending && <p className="status">Loading…</p>}
      {error && <p className="status">Failed to load: {(error as Error).message}</p>}
      {data && data.points.length === 0 && (
        <p className="status">
          No running-dynamics data for this filter. These metrics need a dynamics-capable
          sensor (HRM-Pro, Running Dynamics Pod, or a compatible watch).
        </p>
      )}
      {data && data.points.length > 0 && (
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
