import { useQuery } from '@tanstack/react-query';
import type * as echarts from 'echarts';
import type { DailyHealthPoint, Granularity } from '@fitness/shared';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useChartRange } from '../useChartRange';
import { fetchDailyHealth } from '../api';
import Chart from '../Chart';
import RangeControls from '../RangeControls';
import { baseOption, bar, line, secondsToHours as toH } from '../chartHelpers';
import { buildEventSeries, useEvents } from '../events';
import { appendEvents } from '../chartEvents';

export default function Dashboard() {
  const [searchParams] = useSearchParams();
  const { from, to, granularity, setParam } = useChartRange('day');

  const events = useEvents();
  const { data, isPending, error } = useQuery({
    queryKey: ['daily-health', { granularity, from, to }],
    queryFn: () =>
      fetchDailyHealth({ granularity, from: from || undefined, to: to || undefined }),
    placeholderData: (prev) => prev,
  });

  const charts = useMemo(() => {
    if (!data) return [];
    const p: DailyHealthPoint[] = data.points;
    const dates = p.map((x) => x.date);

    const restingHr = {
      ...baseOption('Resting heart rate (bpm)', dates),
      series: [line('resting HR', p.map((x) => x.restingHr), '#e66a5f')],
    };

    const hrv: echarts.EChartsOption = {
      ...baseOption('HRV nightly avg vs baseline (ms)', dates),
      // Keep the two band-helper series out of the legend.
      legend: {
        type: 'scroll',
        top: 26,
        right: 8,
        left: 8,
        textStyle: { color: '#8a93a0', fontSize: 11 },
        data: ['nightly avg', 'weekly avg'],
      },
      series: [
        line('baseline low', p.map((x) => x.hrvBaselineLow), '#3a4250', {
          stack: 'band',
          lineStyle: { opacity: 0 },
          tooltip: { show: false },
        }),
        line(
          'baseline range',
          p.map((x) =>
            x.hrvBaselineHigh != null && x.hrvBaselineLow != null
              ? x.hrvBaselineHigh - x.hrvBaselineLow
              : null,
          ),
          '#3a4250',
          {
            stack: 'band',
            lineStyle: { opacity: 0 },
            areaStyle: { color: 'rgba(95, 168, 230, 0.18)' },
            tooltip: { show: false },
          },
        ),
        line('nightly avg', p.map((x) => x.hrvNightly), '#5fa8e6'),
        line('weekly avg', p.map((x) => x.hrvWeekly), '#9b7fd4', { lineStyle: { width: 1, type: 'dashed', color: '#9b7fd4' } }),
      ],
    };

    const sleepStages = {
      ...baseOption('Sleep stages (h)', dates),
      series: [
        bar('deep', p.map((x) => toH(x.sleepDeepS)), '#3a6ea8', 'sleep'),
        bar('light', p.map((x) => toH(x.sleepLightS)), '#5fa8e6', 'sleep'),
        bar('REM', p.map((x) => toH(x.sleepRemS)), '#9b7fd4', 'sleep'),
        bar('awake', p.map((x) => toH(x.sleepAwakeS)), '#e6b95f', 'sleep'),
      ],
    };

    const sleepScore = {
      ...baseOption('Sleep score', dates),
      series: [line('sleep score', p.map((x) => x.sleepScore), '#5fce6e')],
    };

    const stress = {
      ...baseOption('Avg stress level', dates),
      series: [line('stress', p.map((x) => x.avgStressLevel), '#e6b95f')],
    };

    const bodyBattery = {
      ...baseOption('Body battery charged / drained', dates),
      series: [
        bar('charged', p.map((x) => x.bodyBatteryCharged), '#5fce6e'),
        bar('drained', p.map((x) => (x.bodyBatteryDrained == null ? null : -x.bodyBatteryDrained)), '#e66a5f'),
      ],
    };

    const steps = {
      ...baseOption(granularity === 'day' ? 'Steps' : 'Steps (avg/day)', dates),
      series: [bar('steps', p.map((x) => x.totalSteps), '#5fa8e6')],
    };

    const intensity = {
      ...baseOption(
        granularity === 'day' ? 'Intensity minutes' : 'Intensity minutes (avg/day)',
        dates,
      ),
      series: [
        bar('moderate', p.map((x) => x.moderateIntensityMin), '#5fa8e6', 'im'),
        bar('vigorous', p.map((x) => x.vigorousIntensityMin), '#e66a5f', 'im'),
      ],
    };

    const defs = [
      { key: 'resting_hr', label: 'Resting HR', option: restingHr },
      { key: 'hrv', label: 'HRV', option: hrv },
      { key: 'sleep_stages', label: 'Sleep stages', option: sleepStages },
      { key: 'sleep_score', label: 'Sleep score', option: sleepScore },
      { key: 'stress', label: 'Stress', option: stress },
      { key: 'body_battery', label: 'Body battery', option: bodyBattery },
      { key: 'steps', label: 'Steps', option: steps },
      { key: 'intensity', label: 'Intensity', option: intensity },
    ];
    const eventSeries = buildEventSeries(events.data, dates);
    const withEvents = appendEvents(defs.map((d) => d.option), eventSeries);
    return defs.map((d, i) => ({ ...d, option: withEvents[i]! }));
  }, [data, granularity, events.data]);

  const hidden = new Set((searchParams.get('hidden') ?? '').split(',').filter(Boolean));
  const toggleChart = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setParam('hidden', [...next].join(','));
  };

  return (
    <>
      <RangeControls
        from={from}
        to={to}
        granularity={granularity}
        setParam={setParam}
        status={data && <span className="status">{data.points.length} points</span>}
      />

      <div className="controls chart-toggles">
        {charts.map((c) => (
          <button
            key={c.key}
            className={hidden.has(c.key) ? '' : 'active'}
            onClick={() => toggleChart(c.key)}
          >
            {hidden.has(c.key) ? '○' : '●'} {c.label}
          </button>
        ))}
      </div>

      {isPending && <p className="status">Loading…</p>}
      {error && <p className="status">Failed to load: {(error as Error).message}</p>}

      <div className="chart-grid">
        {charts
          .filter((c) => !hidden.has(c.key))
          .map((c) => (
            <Chart key={c.key} option={c.option} />
          ))}
      </div>
    </>
  );
}
