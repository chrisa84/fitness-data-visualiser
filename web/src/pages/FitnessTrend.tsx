import { useQuery } from '@tanstack/react-query';
import type * as echarts from 'echarts';
import type { BestEffortPoint } from '@fitness/shared';
import { activityGroupOptionValue } from '@fitness/shared';
import { useMemo, useState } from 'react';
import { fetchEfficiency, fetchFitnessTrend } from '../api';
import Chart from '../Chart';
import RangeControls from '../RangeControls';
import { formatDuration } from '../format';
import { useChartRange } from '../useChartRange';

// EXPERIMENTAL (Phase 20) — every section on this page is a trial. See
// EXPERIMENTS.md for what each metric is and how to remove it cleanly.

const ROLLING_WINDOW_DAYS = 90;

// ---------------------------------------------------------------------------
// VDOT (Daniels & Gilbert): a race-performance-equivalent fitness score
// derived from a best effort's distance and time.
// ---------------------------------------------------------------------------

function vdotFromEffort(distanceM: number, seconds: number): number {
  const tMin = seconds / 60;
  const v = distanceM / tMin; // metres per minute
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const pct =
    0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
  return vo2 / pct;
}

const EFFORT_DISTANCE_M: Record<BestEffortPoint['distanceKey'], number> = {
  '1k': 1000,
  '5k': 5000,
};

// ---------------------------------------------------------------------------
// Age grading — approximate WMA road factors for 5k, interpolated between
// 5-year points. Good enough to show the trend shape; not official scoring.
// ---------------------------------------------------------------------------

type Sex = 'male' | 'female';

const OPEN_STANDARD_5K_S: Record<Sex, number> = { male: 769, female: 884 };

const AGE_FACTORS_5K: Record<Sex, [number, number][]> = {
  male: [
    [30, 1.0], [35, 0.9836], [40, 0.9548], [45, 0.9218], [50, 0.8889],
    [55, 0.8555], [60, 0.8219], [65, 0.7873], [70, 0.7514], [75, 0.7132],
    [80, 0.6712], [85, 0.6234], [90, 0.5684],
  ],
  female: [
    [30, 1.0], [35, 0.9784], [40, 0.9484], [45, 0.9139], [50, 0.877],
    [55, 0.8383], [60, 0.7982], [65, 0.7561], [70, 0.7118], [75, 0.6624],
    [80, 0.6085], [85, 0.5462], [90, 0.4787],
  ],
};

function ageFactor(age: number, sex: Sex): number {
  const table = AGE_FACTORS_5K[sex];
  if (age <= table[0]![0]) return table[0]![1];
  const last = table[table.length - 1]!;
  if (age >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    const [a1, f1] = table[i]!;
    const [a0, f0] = table[i - 1]!;
    if (age <= a1) return f0 + ((age - a0) / (a1 - a0)) * (f1 - f0);
  }
  return last[1];
}

function ageOn(date: string, dob: string): number {
  const d = new Date(`${date}T00:00:00Z`);
  const b = new Date(`${dob}T00:00:00Z`);
  return (d.getTime() - b.getTime()) / (365.25 * 24 * 3600 * 1000);
}

// ---------------------------------------------------------------------------
// Shared chart scaffolding for time-axis charts (irregular effort dates).
// ---------------------------------------------------------------------------

function timeAxisOption(title: string): echarts.EChartsOption {
  return {
    backgroundColor: 'transparent',
    title: { text: title, textStyle: { color: '#e6e8eb', fontSize: 13 }, left: 0, top: 4 },
    legend: { type: 'scroll', top: 26, right: 8, left: 8, textStyle: { color: '#8a93a0', fontSize: 11 } },
    grid: { containLabel: true, left: 8, right: 16, top: 58, bottom: 48 },
    xAxis: { type: 'time' },
    yAxis: { type: 'value', scale: true, splitLine: { lineStyle: { color: '#2a3038' } } },
    dataZoom: [
      { type: 'inside', throttle: 50 },
      { type: 'slider', height: 18, bottom: 8 },
    ],
  };
}

/** Best value per date, then a trailing-window rolling max over those dates. */
function rollingMax(points: { date: string; value: number }[]): [string, number][] {
  const bestPerDay = new Map<string, number>();
  for (const p of points) {
    const cur = bestPerDay.get(p.date);
    if (cur == null || p.value > cur) bestPerDay.set(p.date, p.value);
  }
  const days = [...bestPerDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const out: [string, number][] = [];
  for (let i = 0; i < days.length; i++) {
    const [date] = days[i]!;
    const windowStart = new Date(`${date}T00:00:00Z`);
    windowStart.setUTCDate(windowStart.getUTCDate() - ROLLING_WINDOW_DAYS);
    const startIso = windowStart.toISOString().slice(0, 10);
    let max = -Infinity;
    for (let j = i; j >= 0 && days[j]![0] >= startIso; j--) {
      if (days[j]![1] > max) max = days[j]![1];
    }
    out.push([date, +max.toFixed(1)]);
  }
  return out;
}

function lsGet(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function lsSet(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export default function FitnessTrend() {
  const { from, to, granularity, setParam } = useChartRange('week');
  const type = activityGroupOptionValue('running');
  const [dob, setDob] = useState(() => lsGet('fdv:dob'));
  const [sex, setSex] = useState<Sex>(() => (lsGet('fdv:sex') === 'female' ? 'female' : 'male'));

  const trend = useQuery({
    queryKey: ['fitness-trend', { from, to, granularity }],
    queryFn: () =>
      fetchFitnessTrend({ from: from || undefined, to: to || undefined, granularity, type }),
    placeholderData: (prev) => prev,
  });
  // The classic EF (speed/HR) from the Efficiency page, for side-by-side
  // comparison with the %HRR-normalised variant.
  const classicEf = useQuery({
    queryKey: ['efficiency', { from, to, granularity, type }],
    queryFn: () =>
      fetchEfficiency({ from: from || undefined, to: to || undefined, granularity, type }),
    placeholderData: (prev) => prev,
  });

  const efOption = useMemo<echarts.EChartsOption | null>(() => {
    const points = trend.data?.hrrEf ?? [];
    if (points.length === 0) return null;
    const classicByDate = new Map(
      (classicEf.data?.points ?? []).map((p) => [p.date, p.efficiencyFactor]),
    );
    return {
      ...timeAxisOption('Efficiency: %HRR-normalised vs classic (higher is fitter)'),
      tooltip: { trigger: 'axis' },
      yAxis: [
        {
          type: 'value',
          scale: true,
          name: 'm/min per %HRR',
          nameTextStyle: { color: '#8a93a0' },
          splitLine: { lineStyle: { color: '#2a3038' } },
        },
        { type: 'value', scale: true, name: 'm/min per beat', nameTextStyle: { color: '#8a93a0' }, splitLine: { show: false } },
      ],
      series: [
        {
          type: 'line',
          name: '%HRR EF',
          data: points.map((p) => [p.date, p.hrrEf]),
          yAxisIndex: 0,
          showSymbol: false,
          connectNulls: false,
          lineStyle: { width: 2, color: '#5fce6e' },
          itemStyle: { color: '#5fce6e' },
        },
        {
          type: 'line',
          name: 'Classic EF',
          data: points.map((p) => [p.date, classicByDate.get(p.date) ?? null]),
          yAxisIndex: 1,
          showSymbol: false,
          connectNulls: false,
          lineStyle: { width: 1.5, color: '#5fa8e6', type: 'dashed' },
          itemStyle: { color: '#5fa8e6' },
        },
      ],
    };
  }, [trend.data, classicEf.data]);

  const vdotOption = useMemo<echarts.EChartsOption | null>(() => {
    const efforts = trend.data?.bestEfforts ?? [];
    if (efforts.length === 0) return null;
    const points = efforts.map((e) => ({
      date: e.date,
      key: e.distanceKey,
      value: vdotFromEffort(EFFORT_DISTANCE_M[e.distanceKey], e.seconds),
    }));
    const rolling = rollingMax(points.map((p) => ({ date: p.date, value: p.value })));
    return {
      ...timeAxisOption(`Rolling best-effort VDOT (${ROLLING_WINDOW_DAYS}d window)`),
      tooltip: {
        trigger: 'item',
        formatter: (p) => {
          const param = p as unknown as { seriesName?: string; value: [string, number] };
          return `${param.seriesName}: ${param.value[1]} · ${param.value[0]}`;
        },
      },
      series: [
        {
          type: 'scatter',
          name: '5k effort',
          data: points.filter((p) => p.key === '5k').map((p) => [p.date, +p.value.toFixed(1)]),
          symbolSize: 7,
          itemStyle: { color: '#e6b95f' },
        },
        {
          type: 'scatter',
          name: '1k effort',
          data: points.filter((p) => p.key === '1k').map((p) => [p.date, +p.value.toFixed(1)]),
          symbolSize: 5,
          itemStyle: { color: '#7f8c9b', opacity: 0.7 },
        },
        {
          type: 'line',
          name: 'Rolling best',
          data: rolling,
          showSymbol: false,
          lineStyle: { width: 2, color: '#5fce6e' },
          itemStyle: { color: '#5fce6e' },
        },
      ],
    };
  }, [trend.data]);

  const ageGradeOption = useMemo<echarts.EChartsOption | null>(() => {
    if (!dob) return null;
    const efforts = (trend.data?.bestEfforts ?? []).filter((e) => e.distanceKey === '5k');
    if (efforts.length === 0) return null;
    const points = efforts.map((e) => {
      const factor = ageFactor(ageOn(e.date, dob), sex);
      return { date: e.date, value: (OPEN_STANDARD_5K_S[sex] / (factor * e.seconds)) * 100 };
    });
    const rolling = rollingMax(points);
    return {
      ...timeAxisOption('Age-graded 5k performance (% of age-adjusted world standard)'),
      tooltip: {
        trigger: 'item',
        formatter: (p) => {
          const param = p as unknown as { value: [string, number] };
          return `${param.value[1]}% · ${param.value[0]}`;
        },
      },
      series: [
        {
          type: 'scatter',
          name: 'Effort',
          data: points.map((p) => [p.date, +p.value.toFixed(1)]),
          symbolSize: 7,
          itemStyle: { color: '#b87fff' },
        },
        {
          type: 'line',
          name: 'Rolling best',
          data: rolling,
          showSymbol: false,
          lineStyle: { width: 2, color: '#5fce6e' },
          itemStyle: { color: '#5fce6e' },
        },
      ],
    };
  }, [trend.data, dob, sex]);

  const tempOption = useMemo<echarts.EChartsOption | null>(() => {
    const points = trend.data?.tempPace ?? [];
    if (points.length === 0) return null;
    return {
      backgroundColor: 'transparent',
      title: {
        text: 'Temperature vs pace (steady runs)',
        textStyle: { color: '#e6e8eb', fontSize: 13 },
        left: 0,
        top: 4,
      },
      grid: { containLabel: true, left: 8, right: 16, top: 36, bottom: 16 },
      tooltip: {
        trigger: 'item',
        formatter: (p) => {
          const param = p as unknown as { value: [number, number]; dataIndex: number };
          const pt = points[param.dataIndex]!;
          return `${pt.date} · ${pt.tempC}°C · ${formatDuration(pt.paceSecPerKm)}/km · ${(pt.distanceM / 1000).toFixed(1)} km`;
        },
      },
      xAxis: {
        type: 'value',
        name: '°C',
        nameLocation: 'end',
        splitLine: { lineStyle: { color: '#2a3038' } },
      },
      yAxis: {
        type: 'value',
        inverse: true,
        scale: true,
        axisLabel: { formatter: (v: number) => formatDuration(v) },
        splitLine: { lineStyle: { color: '#2a3038' } },
      },
      series: [
        {
          type: 'scatter',
          name: 'Run',
          data: points.map((p) => [p.tempC, p.paceSecPerKm]),
          symbolSize: 6,
          itemStyle: { color: '#e66a5f', opacity: 0.65 },
        },
      ],
    };
  }, [trend.data]);

  return (
    <>
      <h2>Fitness trend</h2>
      <p className="status">
        <strong>Experimental.</strong> These views are trials of age/effort-adjusted performance
        metrics — they may change or disappear. What each one is and how to remove it is documented
        in EXPERIMENTS.md.
      </p>
      <RangeControls
        from={from}
        to={to}
        granularity={granularity}
        granularities={['week', 'month', 'year']}
        setParam={setParam}
      />

      {trend.isPending && <p className="status">Loading…</p>}
      {trend.error && <p className="status">Failed to load: {(trend.error as Error).message}</p>}

      <section>
        <h3>%HRR-normalised efficiency</h3>
        <p className="status">
          Speed per percent of heart-rate reserve, using the day's resting HR and a rolling
          12-month max observed HR — unlike the classic EF (dashed, from the Efficiency page), it
          stays comparable across years as max HR falls with age. Steady, roughly flat runs ≥ 3 km
          only.
        </p>
        {efOption ? (
          <Chart option={efOption} height={320} />
        ) : (
          !trend.isPending && <p className="status">No qualifying runs in this range.</p>
        )}
      </section>

      <section>
        <h3>Rolling best-effort VDOT</h3>
        <p className="status">
          Daniels VDOT computed from Garmin's fastest-1k/5k splits within each run — the "am I
          actually faster" ground truth. Garmin only records these on recent activities (mostly
          2024 onwards), so the early years are empty.
        </p>
        {vdotOption ? (
          <Chart option={vdotOption} height={320} />
        ) : (
          !trend.isPending && <p className="status">No best-effort data in this range.</p>
        )}
      </section>

      <section>
        <h3>Age-graded 5k performance</h3>
        <p className="status">
          Best 5k efforts scored against an age-adjusted world standard (approximate WMA road
          factors), so the trend answers "am I improving for my age". Needs your date of birth and
          sex — stored only in this browser.
        </p>
        <div className="controls">
          <label>
            date of birth{' '}
            <input
              type="date"
              value={dob}
              onChange={(e) => {
                setDob(e.target.value);
                lsSet('fdv:dob', e.target.value);
              }}
            />
          </label>
          <select
            value={sex}
            onChange={(e) => {
              const v = e.target.value === 'female' ? 'female' : 'male';
              setSex(v);
              lsSet('fdv:sex', v);
            }}
          >
            <option value="male">male</option>
            <option value="female">female</option>
          </select>
        </div>
        {ageGradeOption ? (
          <Chart option={ageGradeOption} height={320} />
        ) : (
          !trend.isPending && (
            <p className="status">
              {dob ? 'No 5k best efforts in this range.' : 'Set a date of birth to enable this chart.'}
            </p>
          )
        )}
      </section>

      <section>
        <h3>Temperature vs pace</h3>
        <p className="status">
          Every steady run's average temperature against its pace — a picture of personal heat
          sensitivity. Temperature comes from the watch, so sun/skin heating inflates warm-day
          readings a little.
        </p>
        {tempOption ? (
          <Chart option={tempOption} height={340} />
        ) : (
          !trend.isPending && <p className="status">No temperature data in this range.</p>
        )}
      </section>
    </>
  );
}
