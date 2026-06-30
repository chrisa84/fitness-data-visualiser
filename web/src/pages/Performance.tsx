import { useQuery } from '@tanstack/react-query';
import type * as echarts from 'echarts';
import type { Granularity, PerformancePoint } from '@fitness/shared';
import { useMemo } from 'react';
import { useChartRange } from '../useChartRange';
import { fetchPerformance } from '../api';
import Chart from '../Chart';
import RangeControls from '../RangeControls';
import { baseOption, line } from '../chartHelpers';
import { appendEvents } from '../chartEvents';
import { buildEventSeries, useEvents } from '../events';
import { formatDuration } from '../format';
import { STATUS_COLOR, STATUS_ORDER, baseStatus } from '../trainingStatus';

const timeAxis = (): echarts.YAXisComponentOption => ({
  type: 'value',
  scale: true,
  axisLabel: { formatter: (v: number) => formatDuration(v) },
  splitLine: { lineStyle: { color: '#2a3038' } },
});

const timeTooltip = { trigger: 'axis', valueFormatter: (v: unknown) => formatDuration(v as number) } as const;

export default function Performance() {
  const { from, to, granularity, setParam } = useChartRange('day');

  const events = useEvents();
  const { data, isPending, error } = useQuery({
    queryKey: ['performance', { granularity, from, to }],
    queryFn: () => fetchPerformance({ granularity, from: from || undefined, to: to || undefined }),
    placeholderData: (prev) => prev,
  });

  const charts = useMemo(() => {
    if (!data) return [];
    const p: PerformancePoint[] = data.points;
    const dates = p.map((x) => x.date);
    const out: echarts.EChartsOption[] = [];

    out.push({
      ...baseOption('VO2max', dates),
      series: [
        line('VO2max', p.map((x) => x.vo2max), '#5fce6e'),
        line('precise', p.map((x) => x.vo2maxPrecise), '#9b7fd4', {
          lineStyle: { width: 1, type: 'dashed', color: '#9b7fd4' },
        }),
      ],
    });

    out.push({
      ...baseOption('Fitness age (years)', dates),
      series: [line('fitness age', p.map((x) => x.fitnessAge), '#e6b95f')],
    });

    out.push({
      ...baseOption('Training load — acute vs chronic', dates),
      series: [
        line('acute (7d)', p.map((x) => x.acuteLoad), '#e66a5f'),
        line('chronic (28d)', p.map((x) => x.chronicLoad), '#5fa8e6'),
      ],
    });

    // Performance Management Chart: Fitness (chronic), Fatigue (acute), and
    // Form = Fitness − Fatigue. Positive form = fresh/tapered; very negative =
    // fatigued. A zero line marks the balance point.
    const form = p.map((x) =>
      x.chronicLoad != null && x.acuteLoad != null ? Math.round(x.chronicLoad - x.acuteLoad) : null,
    );
    out.push({
      ...baseOption('Form — fitness minus fatigue (PMC)', dates),
      series: [
        line('Fitness (chronic)', p.map((x) => x.chronicLoad), '#5fa8e6'),
        line('Fatigue (acute)', p.map((x) => x.acuteLoad), '#e66a5f'),
        line('Form', form, '#c98fe6', {
          areaStyle: { opacity: 0.15 },
          markLine: {
            silent: true,
            symbol: 'none',
            data: [{ yAxis: 0 }] as never,
            lineStyle: { color: '#6b7480', type: 'dashed' },
            label: { show: false },
          },
        }),
      ],
    });

    // ACWR with optimal (0.8–1.3) and high-risk (>1.5) zones shaded.
    out.push({
      ...baseOption('Acute:chronic workload ratio', dates),
      series: [
        line('ACWR', p.map((x) => x.acwr), '#e6e8eb', {
          markArea: {
            silent: true,
            data: [
              [{ yAxis: 0.8, itemStyle: { color: 'rgba(95, 206, 110, 0.10)' } }, { yAxis: 1.3 }],
              [{ yAxis: 1.5, itemStyle: { color: 'rgba(230, 106, 95, 0.12)' } }, { yAxis: 100 }],
            ] as never,
          },
        }),
      ],
    });

    out.push({
      ...baseOption('Training readiness', dates),
      series: [line('readiness', p.map((x) => x.readinessScore), '#5fce6e')],
    });

    out.push({
      ...baseOption('Readiness factors (%)', dates),
      series: [
        line('HRV', p.map((x) => x.readinessHrvPct), '#5fa8e6'),
        line('sleep', p.map((x) => x.readinessSleepPct), '#9b7fd4'),
        line('stress', p.map((x) => x.readinessStressPct), '#e6b95f'),
      ],
    });

    out.push({
      ...baseOption('Race predictions — 5K & 10K', dates),
      tooltip: timeTooltip,
      yAxis: timeAxis(),
      series: [
        line('5K', p.map((x) => x.race5kS), '#5fce6e'),
        line('10K', p.map((x) => x.race10kS), '#5fa8e6'),
      ],
    });

    out.push({
      ...baseOption('Race predictions — half & marathon', dates),
      tooltip: timeTooltip,
      yAxis: timeAxis(),
      series: [
        line('half', p.map((x) => x.raceHalfS), '#9b7fd4'),
        line('marathon', p.map((x) => x.raceFullS), '#e66a5f'),
      ],
    });

    out.push({
      ...baseOption('Lactate threshold', dates),
      series: [
        line('threshold HR (bpm)', p.map((x) => x.lactateThresholdHr), '#e66a5f'),
        line('threshold power (W)', p.map((x) => x.lactateThresholdPowerW), '#5fa8e6'),
      ],
    });

    out.push({
      ...baseOption('Endurance score', dates),
      series: [line('endurance', p.map((x) => x.enduranceScore), '#5fce6e')],
    });

    out.push({
      ...baseOption('Hill score', dates),
      series: [
        line('overall', p.map((x) => x.hillScore), '#5fce6e'),
        line('strength', p.map((x) => x.hillStrength), '#e6b95f'),
        line('endurance', p.map((x) => x.hillEndurance), '#5fa8e6'),
      ],
    });

    // Training status phrase only exists per day; render a colour-coded timeline.
    if (granularity === 'day') {
      const statusData = p
        .map((x) => {
          const base = baseStatus(x.trainingStatus);
          return base ? { value: [x.date, base], itemStyle: { color: STATUS_COLOR[base] } } : null;
        })
        .filter((d): d is { value: [string, string]; itemStyle: { color: string } } => d !== null);
      out.push({
        backgroundColor: 'transparent',
        title: { text: 'Training status', textStyle: { color: '#e6e8eb', fontSize: 13 } },
        tooltip: {
          trigger: 'item',
          formatter: (d: unknown) => {
            const value = (d as { value: [string, string] }).value;
            return `${value[0]}<br/>${value[1]}`;
          },
        },
        grid: { left: 110, right: 16, top: 36, bottom: 56 },
        xAxis: { type: 'category', data: dates },
        yAxis: { type: 'category', data: [...STATUS_ORDER], axisLabel: { fontSize: 10 } },
        dataZoom: [
          { type: 'inside', throttle: 50 },
          { type: 'slider', height: 18, bottom: 8 },
        ],
        series: [{ type: 'scatter', symbolSize: 6, data: statusData }],
      });
    }

    return appendEvents(out, buildEventSeries(events.data, dates));
  }, [data, granularity, events.data]);

  return (
    <>
      <RangeControls
        from={from}
        to={to}
        granularity={granularity}
        setParam={setParam}
        status={data && <span className="status">{data.points.length} points</span>}
      />

      {isPending && <p className="status">Loading…</p>}
      {error && <p className="status">Failed to load: {(error as Error).message}</p>}

      <div className="chart-grid">
        {charts.map((option, i) => (
          <Chart key={i} option={option} />
        ))}
      </div>
    </>
  );
}
