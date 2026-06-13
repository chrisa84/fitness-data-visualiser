import { useQuery, useQueries } from '@tanstack/react-query';
import type * as echarts from 'echarts';
import type { Granularity, MetricMeta } from '@fitness/shared';
import { METRIC_CATALOG, metricMeta } from '@fitness/shared';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchMetrics } from '../api';
import Chart from '../Chart';
import RangeControls from '../RangeControls';
import { baseOption, line } from '../chartHelpers';
import { useEvents, buildEventSeries } from '../events';
import { formatDuration } from '../format';

type Mode = 'overlay' | 'compare' | 'correlate';
const MODES: Mode[] = ['overlay', 'compare', 'correlate'];
const GROUPS = ['Health', 'Sleep', 'Recovery', 'Training', 'Performance'] as const;
const SERIES_COLORS = ['#5fa8e6', '#e66a5f', '#5fce6e', '#e6b95f', '#9b7fd4'];

function formatMetric(value: number | null, meta: MetricMeta | undefined): string {
  if (value == null) return '—';
  if (meta?.format === 'duration') return formatDuration(value);
  return `${value}${meta?.unit ? ` ${meta.unit}` : ''}`;
}

function normalise(values: (number | null)[]): (number | null)[] {
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0) return values;
  const min = Math.min(...present);
  const max = Math.max(...present);
  const span = max - min || 1;
  return values.map((v) => (v == null ? null : (v - min) / span));
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function pearson(pairs: [number, number][]): number | null {
  const n = pairs.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) {
    sx += x; sy += y; sxy += x * y; sxx += x * x; syy += y * y;
  }
  const cov = sxy - (sx * sy) / n;
  const denom = Math.sqrt((sxx - (sx * sx) / n) * (syy - (sy * sy) / n));
  return denom === 0 ? null : cov / denom;
}

function MetricMultiPicker({ selected, onToggle }: { selected: string[]; onToggle: (key: string) => void }) {
  return (
    <div className="metric-picker">
      {GROUPS.map((group) => (
        <div key={group} className="metric-group">
          <span className="metric-group-label">{group}</span>
          {METRIC_CATALOG.filter((m) => m.group === group).map((m) => (
            <label key={m.key} className="metric-check">
              <input type="checkbox" checked={selected.includes(m.key)} onChange={() => onToggle(m.key)} />
              {m.label}
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

function MetricSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {GROUPS.map((group) => (
        <optgroup key={group} label={group}>
          {METRIC_CATALOG.filter((m) => m.group === group).map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export default function Analysis() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = (searchParams.get('mode') as Mode) ?? 'overlay';

  const setParam = (key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  };

  return (
    <>
      <div className="controls">
        {MODES.map((m) => (
          <button
            key={m}
            onClick={() => setParam('mode', m)}
            className={mode === m ? 'active' : ''}
          >
            {m}
          </button>
        ))}
      </div>
      {mode === 'overlay' && <Overlay searchParams={searchParams} setParam={setParam} />}
      {mode === 'compare' && <Compare searchParams={searchParams} setParam={setParam} />}
      {mode === 'correlate' && <Correlate searchParams={searchParams} setParam={setParam} />}
    </>
  );
}

interface PaneProps {
  searchParams: URLSearchParams;
  setParam: (key: string, value: string) => void;
}

function Overlay({ searchParams, setParam }: PaneProps) {
  const keys = (searchParams.get('keys') ?? 'training_load_acute,sleep_score,hrv_nightly')
    .split(',')
    .filter(Boolean);
  const granularity = (searchParams.get('granularity') as Granularity) ?? 'day';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';

  const toggle = (key: string) => {
    const next = keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key].slice(0, 5);
    setParam('keys', next.join(','));
  };

  const events = useEvents();
  const { data, isPending, error } = useQuery({
    queryKey: ['metrics', { keys, granularity, from, to }],
    queryFn: () => fetchMetrics({ keys, granularity, from: from || undefined, to: to || undefined }),
    enabled: keys.length > 0,
    placeholderData: (prev) => prev,
  });

  const option = useMemo<echarts.EChartsOption>(() => {
    const points = data?.points ?? [];
    const dates = points.map((p) => p.date);
    const series = keys.map((key, i) => {
      const meta = metricMeta(key);
      const raw = points.map((p) => p.values[key] ?? null);
      const norm = normalise(raw);
      return line(
        meta?.label ?? key,
        norm,
        SERIES_COLORS[i % SERIES_COLORS.length]!,
        { data: norm.map((v, j) => ({ value: v, raw: raw[j] })) as never },
      );
    });
    const eventSeries = buildEventSeries(events.data, dates);
    return {
      ...baseOption('Metric overlay (each normalised to its own range)', dates),
      yAxis: { type: 'value', axisLabel: { show: false }, splitLine: { lineStyle: { color: '#2a3038' } } },
      tooltip: {
        trigger: 'axis',
        formatter: (params: unknown) => {
          const rows = params as { axisValue: string; seriesName: string; color: string; data: { raw: number | null } }[];
          if (rows.length === 0) return '';
          const head = `<b>${rows[0]!.axisValue}</b>`;
          const lines = rows
            .filter((r) => r.seriesName !== 'events')
            .map((r) => {
              const meta = METRIC_CATALOG.find((m) => m.label === r.seriesName);
              return `${r.seriesName}: ${formatMetric(r.data?.raw ?? null, meta)}`;
            });
          return [head, ...lines].join('<br/>');
        },
      },
      series: eventSeries ? [...series, eventSeries] : series,
    };
  }, [data, keys, events.data]);

  return (
    <>
      <MetricMultiPicker selected={keys} onToggle={toggle} />
      <RangeControls
        from={from}
        to={to}
        granularity={granularity}
        setParam={setParam}
        status={data && <span className="status">{data.points.length} points</span>}
      />
      {isPending && keys.length > 0 && <p className="status">Loading…</p>}
      {error && <p className="status">Failed to load: {(error as Error).message}</p>}
      {keys.length === 0 && <p className="status">Pick one or more metrics to overlay.</p>}
      {data && <Chart option={option} height={460} />}
    </>
  );
}

function Compare({ searchParams, setParam }: PaneProps) {
  const metric = searchParams.get('metric') ?? 'training_load_acute';
  const aFrom = searchParams.get('aFrom') ?? '';
  const aTo = searchParams.get('aTo') ?? '';
  const bFrom = searchParams.get('bFrom') ?? '';
  const bTo = searchParams.get('bTo') ?? '';
  const meta = metricMeta(metric);

  const results = useQueries({
    queries: [
      { from: aFrom, to: aTo, label: 'A' },
      { from: bFrom, to: bTo, label: 'B' },
    ].map(({ from, to }) => ({
      queryKey: ['metrics-compare', { metric, from, to }],
      queryFn: () => fetchMetrics({ keys: [metric], granularity: 'day' as Granularity, from: from || undefined, to: to || undefined }),
    })),
  });

  const option = useMemo<echarts.EChartsOption>(() => {
    const seriesA = results[0]?.data?.points.map((p) => p.values[metric] ?? null) ?? [];
    const seriesB = results[1]?.data?.points.map((p) => p.values[metric] ?? null) ?? [];
    const len = Math.max(seriesA.length, seriesB.length);
    const axis = Array.from({ length: len }, (_, i) => `day ${i + 1}`);
    return {
      ...baseOption(`Period comparison — ${meta?.label ?? metric}`, axis),
      tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => formatMetric(v as number | null, meta) },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: meta?.format === 'duration' ? { formatter: (v: number) => formatDuration(v) } : undefined,
        splitLine: { lineStyle: { color: '#2a3038' } },
      },
      series: [line('Period A', seriesA, '#5fa8e6'), line('Period B', seriesB, '#e66a5f')],
    };
  }, [results[0]?.data, results[1]?.data, metric]);

  return (
    <>
      <div className="controls">
        <label>metric <MetricSelect value={metric} onChange={(v) => setParam('metric', v)} /></label>
      </div>
      <div className="controls">
        <span className="status">Period A</span>
        <input type="date" value={aFrom} onChange={(e) => setParam('aFrom', e.target.value)} />
        <input type="date" value={aTo} onChange={(e) => setParam('aTo', e.target.value)} />
        <span className="status">Period B</span>
        <input type="date" value={bFrom} onChange={(e) => setParam('bFrom', e.target.value)} />
        <input type="date" value={bTo} onChange={(e) => setParam('bTo', e.target.value)} />
      </div>
      {(!aFrom || !bFrom) && <p className="status">Set a start date for both periods to compare them.</p>}
      <Chart option={option} height={460} />
    </>
  );
}

function Correlate({ searchParams, setParam }: PaneProps) {
  const x = searchParams.get('x') ?? 'training_load_acute';
  const y = searchParams.get('y') ?? 'hrv_nightly';
  const lag = Number(searchParams.get('lag') ?? '0');
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const xMeta = metricMeta(x);
  const yMeta = metricMeta(y);

  const { data } = useQuery({
    queryKey: ['metrics-correlate', { x, y, from, to }],
    queryFn: () => fetchMetrics({ keys: [x, y], granularity: 'day', from: from || undefined, to: to || undefined }),
    placeholderData: (prev) => prev,
  });

  const { pairs, r } = useMemo(() => {
    const points = data?.points ?? [];
    const byDate = new Map(points.map((p) => [p.date, p.values]));
    const out: [number, number][] = [];
    for (const p of points) {
      const xv = p.values[x];
      const yv = byDate.get(addDays(p.date, lag))?.[y];
      if (typeof xv === 'number' && typeof yv === 'number') out.push([xv, yv]);
    }
    return { pairs: out, r: pearson(out) };
  }, [data, x, y, lag]);

  const option = useMemo<echarts.EChartsOption>(
    () => ({
      backgroundColor: 'transparent',
      title: {
        text: `${xMeta?.label ?? x} vs ${yMeta?.label ?? y}${lag ? ` (lag ${lag}d)` : ''}`,
        subtext: r == null ? 'not enough overlapping data' : `Pearson r = ${r.toFixed(2)} (n=${pairs.length})`,
        textStyle: { color: '#e6e8eb', fontSize: 13 },
        subtextStyle: { color: '#8a93a0' },
      },
      grid: { left: 56, right: 20, top: 56, bottom: 48 },
      tooltip: {
        trigger: 'item',
        formatter: (p: unknown) => {
          const v = (p as { value: [number, number] }).value;
          return `${formatMetric(v[0], xMeta)}, ${formatMetric(v[1], yMeta)}`;
        },
      },
      xAxis: { type: 'value', scale: true, name: xMeta?.label, nameLocation: 'middle', nameGap: 28, splitLine: { lineStyle: { color: '#2a3038' } } },
      yAxis: { type: 'value', scale: true, name: yMeta?.label, splitLine: { lineStyle: { color: '#2a3038' } } },
      series: [{ type: 'scatter', symbolSize: 5, itemStyle: { color: '#5fa8e6', opacity: 0.55 }, data: pairs }],
    }),
    [pairs, r, x, y, lag],
  );

  return (
    <>
      <div className="controls">
        <label>X <MetricSelect value={x} onChange={(v) => setParam('x', v)} /></label>
        <label>Y <MetricSelect value={y} onChange={(v) => setParam('y', v)} /></label>
        <label>
          Y lag{' '}
          <select value={String(lag)} onChange={(e) => setParam('lag', e.target.value === '0' ? '' : e.target.value)}>
            <option value="0">same day</option>
            <option value="1">+1 day</option>
            <option value="2">+2 days</option>
            <option value="-1">−1 day</option>
          </select>
        </label>
        <label>from <input type="date" value={from} onChange={(e) => setParam('from', e.target.value)} /></label>
        <label>to <input type="date" value={to} onChange={(e) => setParam('to', e.target.value)} /></label>
      </div>
      <Chart option={option} height={460} />
    </>
  );
}
