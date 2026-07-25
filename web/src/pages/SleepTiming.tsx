import { useQuery } from '@tanstack/react-query';
import type * as echarts from 'echarts';
import type { SleepNightPoint } from '@fitness/shared';
import { useMemo, useState } from 'react';
import { fetchSleepTiming } from '../api';
import Chart from '../Chart';
import RangeControls from '../RangeControls';
import { compactOption, timeAxisOption } from '../chartHelpers';
import { useChartRange } from '../useChartRange';

// EXPERIMENTAL (Phase 21) — every section here is a trial. See EXPERIMENTS.md
// for what each metric is and how to remove it cleanly.

/**
 * Night-centred minutes back to a clock string: -60 → 23:00, 390 → 06:30.
 * Wrapping with a double modulo keeps negatives correct without a branch.
 */
function clock(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Signed offset as a readable duration: 95 → "1h 35m later". */
function signedDuration(minutes: number): string {
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const size = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return `${size} ${minutes >= 0 ? 'later' : 'earlier'}`;
}

const MORNING_METRICS = [
  { key: 'morningRestingHr', label: 'Resting HR', unit: 'bpm' },
  { key: 'morningHrv', label: 'HRV (nightly)', unit: 'ms' },
  { key: 'morningReadiness', label: 'Training readiness', unit: '' },
  { key: 'morningBodyBattery', label: 'Body battery (peak)', unit: '' },
] as const;

type MorningKey = (typeof MORNING_METRICS)[number]['key'];

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export default function SleepTiming() {
  const { from, to, setParam } = useChartRange('day');
  const [morningKey, setMorningKey] = useState<MorningKey>('morningRestingHr');

  const timing = useQuery({
    queryKey: ['sleep-timing', { from, to }],
    queryFn: () => fetchSleepTiming({ from: from || undefined, to: to || undefined }),
    placeholderData: (prev) => prev,
  });

  const nights = timing.data?.nights ?? [];
  const morningMeta = MORNING_METRICS.find((m) => m.key === morningKey)!;

  const timingOption = useMemo<echarts.EChartsOption | null>(() => {
    if (nights.length === 0) return null;
    const series = (
      name: string,
      pick: (n: SleepNightPoint) => number | null,
      colour: string,
      width = 1.5,
    ) => ({
      type: 'line' as const,
      name,
      data: nights.map((n) => [n.date, pick(n)]),
      showSymbol: false,
      connectNulls: false,
      lineStyle: { width, color: colour },
      itemStyle: { color: colour },
    });

    return {
      ...timeAxisOption('When you sleep (clock time each night)'),
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: unknown) => (typeof v === 'number' ? clock(v) : '—'),
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { formatter: (v: number) => clock(v) },
        splitLine: { lineStyle: { color: '#2a3038' } },
      },
      series: [
        series('Asleep', (n) => n.bedtimeMin, '#b87fff'),
        series('Midpoint', (n) => n.midpointMin, '#5fce6e', 2),
        series('Awake', (n) => n.wakeMin, '#e6b95f'),
      ],
    };
  }, [nights]);

  const regularityOption = useMemo<echarts.EChartsOption | null>(() => {
    const points = nights.filter((n) => n.regularityMin != null);
    if (points.length === 0) return null;
    return {
      ...timeAxisOption(
        `Sleep regularity (rolling ${timing.data?.regularityWindowNights ?? 14}-night spread — lower is steadier)`,
      ),
      legend: { show: false },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: unknown) => (typeof v === 'number' ? `± ${Math.round(v)} min` : '—'),
      },
      series: [
        {
          type: 'line',
          name: 'Midpoint spread',
          data: points.map((n) => [n.date, n.regularityMin]),
          showSymbol: false,
          areaStyle: { color: 'rgba(95,168,230,0.15)' },
          lineStyle: { width: 2, color: '#5fa8e6' },
          itemStyle: { color: '#5fa8e6' },
        },
      ],
    };
  }, [nights, timing.data]);

  const jetlagOption = useMemo<echarts.EChartsOption | null>(() => {
    const points = (timing.data?.socialJetlag ?? []).filter((p) => p.jetlagMin != null);
    if (points.length === 0) return null;
    const dates = points.map((p) => p.weekStart);
    return {
      ...compactOption('Social jetlag (weekend vs weekday body clock)', dates),
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: unknown) => (typeof v === 'number' ? signedDuration(v) : '—'),
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { formatter: (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}m` },
        splitLine: { lineStyle: { color: '#2a3038' } },
      },
      series: [
        {
          type: 'bar',
          name: 'Weekend shift',
          // Coloured per point rather than by a callback: sleeping later at
          // weekends is the usual, notable direction; earlier is unusual enough
          // to deserve its own colour.
          data: points.map((p) => ({
            value: p.jetlagMin,
            itemStyle: { color: (p.jetlagMin ?? 0) >= 0 ? '#e6b95f' : '#5fa8e6' },
          })),
          barCategoryGap: '30%',
        },
      ],
    };
  }, [timing.data]);

  const scatterOption = useMemo<echarts.EChartsOption | null>(() => {
    const points = nights.filter((n) => n.midpointMin != null && n[morningKey] != null);
    if (points.length < 3) return null;
    return {
      backgroundColor: 'transparent',
      title: {
        text: `Sleep midpoint vs next morning's ${morningMeta.label.toLowerCase()}`,
        textStyle: { color: '#e6e8eb', fontSize: 13 },
        left: 0,
        top: 4,
      },
      grid: { containLabel: true, left: 8, right: 16, top: 36, bottom: 16 },
      tooltip: {
        trigger: 'item',
        formatter: (p) => {
          const param = p as unknown as { dataIndex: number };
          const night = points[param.dataIndex]!;
          return `${night.date} · midpoint ${clock(night.midpointMin!)} · ${morningMeta.label} ${night[morningKey]}`;
        },
      },
      xAxis: {
        type: 'value',
        name: 'midpoint',
        nameLocation: 'end',
        scale: true,
        axisLabel: { formatter: (v: number) => clock(v) },
        splitLine: { lineStyle: { color: '#2a3038' } },
      },
      yAxis: {
        type: 'value',
        scale: true,
        name: morningMeta.unit,
        nameTextStyle: { color: '#8a93a0' },
        splitLine: { lineStyle: { color: '#2a3038' } },
      },
      series: [
        {
          type: 'scatter',
          name: morningMeta.label,
          data: points.map((n) => [n.midpointMin, n[morningKey]]),
          symbolSize: 6,
          itemStyle: { color: '#5fce6e', opacity: 0.65 },
        },
      ],
    };
  }, [nights, morningKey, morningMeta]);

  // A headline both halves of the page can be read against.
  const summary = useMemo(() => {
    const midpoints = nights.map((n) => n.midpointMin).filter((v): v is number => v != null);
    const latest = [...nights].reverse().find((n) => n.regularityMin != null);
    return {
      nights: nights.length,
      typicalMidpoint: mean(midpoints),
      regularity: latest?.regularityMin ?? null,
    };
  }, [nights]);

  return (
    <>
      <h2>Sleep timing</h2>
      <p className="status">
        <strong>Experimental.</strong> Not how <em>much</em> you sleep — <em>when</em>. Body-clock
        regularity tracks health outcomes at least as closely as duration does, and Garmin records
        the start and end of every night without surfacing any of this. Trial views; they may change
        or disappear. See EXPERIMENTS.md.
      </p>

      <RangeControls from={from} to={to} granularity="day" granularities={['day']} setParam={setParam} />

      {timing.isPending && <p className="status">Loading…</p>}
      {timing.error && <p className="status">Failed to load: {(timing.error as Error).message}</p>}
      {timing.data && nights.length === 0 && (
        <p className="status">
          No nights with recorded sleep start/end in this range. Garmin only stores these for nights
          the watch was worn.
        </p>
      )}

      {nights.length > 0 && (
        <p className="status">
          {summary.nights} nights ·{' '}
          {summary.typicalMidpoint != null
            ? `typical midpoint ${clock(summary.typicalMidpoint)}`
            : 'midpoint unavailable'}
          {summary.regularity != null ? ` · latest spread ± ${summary.regularity} min` : ''}
        </p>
      )}

      <section>
        <h3>When you sleep</h3>
        <p className="status">
          Bedtime, midpoint and wake time each night, on a clock axis that runs through midnight
          rather than wrapping at it. The midpoint is the line to watch — it is what "body clock"
          means in practice.
        </p>
        {timingOption ? <Chart option={timingOption} height={320} /> : null}
      </section>

      <section>
        <h3>Regularity</h3>
        <p className="status">
          How much your sleep midpoint has varied over the trailing{' '}
          {timing.data?.regularityWindowNights ?? 14} nights. A flat low line is a steady body clock;
          spikes are the weeks your routine broke. Nights the watch missed are skipped, not counted
          as zero.
        </p>
        {regularityOption ? (
          <Chart option={regularityOption} height={260} />
        ) : (
          !timing.isPending && nights.length > 0 && (
            <p className="status">Not enough consecutive nights yet to measure a spread.</p>
          )
        )}
      </section>

      <section>
        <h3>Social jetlag</h3>
        <p className="status">
          How much later your body clock runs at weekends than on weekdays, per week. A persistent
          gap has the same shape as flying a couple of time zones every Friday and back every Monday.
        </p>
        {jetlagOption ? (
          <Chart option={jetlagOption} height={260} />
        ) : (
          !timing.isPending && (
            <p className="status">Needs weeks with both weekday and weekend nights recorded.</p>
          )
        )}
      </section>

      <section>
        <h3>Does it show the next morning?</h3>
        <p className="status">
          Each night's midpoint against a health metric from the following morning. Garmin keys sleep
          by the wake date, so these really are the morning-after readings. This is a scatter of your
          own habits, not a controlled trial — a slope here is a hint worth testing, not proof.
        </p>
        <div className="controls">
          <select value={morningKey} onChange={(e) => setMorningKey(e.target.value as MorningKey)}>
            {MORNING_METRICS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        {scatterOption ? (
          <Chart option={scatterOption} height={320} />
        ) : (
          !timing.isPending && (
            <p className="status">No {morningMeta.label.toLowerCase()} readings in this range.</p>
          )
        )}
      </section>
    </>
  );
}
