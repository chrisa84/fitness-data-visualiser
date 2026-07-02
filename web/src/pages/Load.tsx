import { useQuery } from '@tanstack/react-query';
import type * as echarts from 'echarts';
import { useMemo } from 'react';
import { fetchTrainingLoad } from '../api';
import Chart from '../Chart';
import RangeControls from '../RangeControls';
import { bar, compactOption, line } from '../chartHelpers';
import { useChartRange } from '../useChartRange';

export default function Load() {
  const { from, to, setParam } = useChartRange();

  const { data, isPending, error } = useQuery({
    queryKey: ['training-load', { from, to }],
    queryFn: () => fetchTrainingLoad({ from: from || undefined, to: to || undefined }),
    placeholderData: (prev) => prev,
  });

  const charts = useMemo<echarts.EChartsOption[]>(() => {
    const points = data?.points ?? [];
    const dates = points.map((p) => p.date);
    return [
      {
        ...compactOption('Weekly training load', dates),
        series: [bar('load', points.map((p) => p.weeklyLoad), '#5fa8e6')],
      },
      {
        // Monotony >2 is commonly flagged as a higher-risk "grind"; shade it.
        ...compactOption('Monotony (higher = same intensity every day)', dates),
        series: [
          line('monotony', points.map((p) => p.monotony), '#e6b95f', {
            showSymbol: true,
            symbolSize: 4,
            markArea: {
              silent: true,
              data: [[{ yAxis: 2 }, { yAxis: 100 }]] as never,
              itemStyle: { color: 'rgba(230, 106, 95, 0.12)' },
            },
          }),
        ],
      },
      {
        ...compactOption('Strain (weekly load × monotony)', dates),
        series: [line('strain', points.map((p) => p.strain), '#e66a5f', { showSymbol: true, symbolSize: 4 })],
      },
    ];
  }, [data]);

  return (
    <>
      <RangeControls
        from={from}
        to={to}
        granularity="week"
        granularities={['week']}
        setParam={setParam}
        status={data && <span className="status">{data.points.length} weeks</span>}
      />

      {isPending && <p className="status">Loading…</p>}
      {error && <p className="status">Failed to load: {(error as Error).message}</p>}
      {data && data.points.length > 0 && (
        <>
          <p className="status">
            Foster monotony &amp; strain, weekly. Rest days count as zero load. Sustained high
            monotony (above ~2) or strain spikes are associated with raised injury/illness risk.
          </p>
          <div className="chart-grid">
            {charts.map((option, i) => (
              <Chart key={i} option={option} height={280} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
