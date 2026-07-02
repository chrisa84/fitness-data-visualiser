import type * as echarts from 'echarts';

export const DATE_PRESETS: { label: string; days: number | null }[] = [
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '1y', days: 365 },
  { label: 'all', days: null },
];

export function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Shared dark-theme base for a category-axis chart with zoom. */
export function baseOption(title: string, dates: string[]): echarts.EChartsOption {
  return {
    backgroundColor: 'transparent',
    // Title on its own row; legend on the row below it (scrolling if long) so a
    // long title and a many-item legend never collide on the top edge.
    title: { text: title, textStyle: { color: '#e6e8eb', fontSize: 13 }, left: 0, top: 4 },
    tooltip: { trigger: 'axis' },
    legend: { type: 'scroll', top: 26, right: 8, left: 8, textStyle: { color: '#8a93a0', fontSize: 11 } },
    grid: { left: 48, right: 16, top: 58, bottom: 56 },
    xAxis: { type: 'category', data: dates },
    yAxis: { type: 'value', scale: true, splitLine: { lineStyle: { color: '#2a3038' } } },
    dataZoom: [
      { type: 'inside', throttle: 50 },
      { type: 'slider', height: 18, bottom: 8 },
    ],
  };
}

/**
 * `baseOption` for single-series charts: no legend row, and `containLabel`
 * auto-sizes the left gutter so pages stop hand-tuning `grid.left` per chart.
 * Prefer this over spreading `baseOption` and overriding `legend`/`grid` inline.
 */
export function compactOption(title: string, dates: string[]): echarts.EChartsOption {
  return {
    ...baseOption(title, dates),
    legend: { show: false },
    grid: { containLabel: true, left: 8, right: 16, top: 36, bottom: 48 },
  };
}

export function line(
  name: string,
  data: (number | null)[],
  color: string,
  extra: Partial<echarts.LineSeriesOption> = {},
): echarts.LineSeriesOption {
  return {
    type: 'line',
    name,
    data,
    showSymbol: false,
    connectNulls: false,
    lineStyle: { width: 1.5, color },
    itemStyle: { color },
    ...extra,
  };
}

export function bar(
  name: string,
  data: (number | null)[],
  color: string,
  stack?: string,
): echarts.BarSeriesOption {
  return { type: 'bar', name, data, stack, itemStyle: { color }, barCategoryGap: '20%' };
}

/**
 * Companion to `robustExtent`: a scatter series that pins clipped points to the
 * nearest axis edge so an outlier is visible instead of silently off-chart. The
 * axis tooltip still shows the true value from the main series at that x.
 * Returns null when nothing is clipped.
 */
export function offScaleMarkers(
  values: (number | null)[],
  extent: { min?: number; max?: number },
  color: string,
): echarts.ScatterSeriesOption | null {
  if (extent.min == null || extent.max == null) return null;
  const data = values
    .map((v, i) => {
      if (v == null || (v >= extent.min! && v <= extent.max!)) return null;
      return [i, v > extent.max! ? extent.max! : extent.min!] as [number, number];
    })
    .filter((d): d is [number, number] => d !== null);
  if (data.length === 0) return null;
  return {
    type: 'scatter',
    name: 'off-scale',
    data,
    symbol: 'diamond',
    symbolSize: 8,
    itemStyle: { color, opacity: 0.9 },
    z: 3,
  };
}

/**
 * Bucket-average an [x, y] series down to at most `maxPoints` points. Per-second
 * activity streams are noisy enough that plotting every raw sample renders as a
 * solid band; averaging keeps the trend readable and cheap.
 */
export function bucketAverage(data: (number | null)[][], maxPoints: number): (number | null)[][] {
  if (data.length <= maxPoints) return data;
  const bucketSize = Math.ceil(data.length / maxPoints);
  const out: (number | null)[][] = [];
  for (let start = 0; start < data.length; start += bucketSize) {
    const bucket = data.slice(start, start + bucketSize);
    const ys = bucket.map((p) => p[1]).filter((v): v is number => v != null);
    const mid = bucket[bucket.length >> 1]!;
    out.push([mid[0] ?? null, ys.length ? +(ys.reduce((a, b) => a + b, 0) / ys.length).toFixed(2) : null]);
  }
  return out;
}

export const secondsToHours = (s: number | null) =>
  s == null ? null : Math.round((s / 3600) * 100) / 100;

/**
 * Axis min/max that ignore outliers via an IQR fence, so a single stray value
 * cannot squash the rest of the series into a thin band. Returns `{}` (let
 * ECharts auto-scale) when there is too little data to judge. Points beyond the
 * returned range are clipped from view, not removed.
 */
export function robustExtent(values: (number | null | undefined)[]): { min?: number; max?: number } {
  const xs = values
    .filter((v): v is number => typeof v === 'number')
    .sort((a, b) => a - b);
  if (xs.length < 5) return {};
  const at = (p: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.round(p * (xs.length - 1))))]!;
  const q1 = at(0.25);
  const q3 = at(0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  const inliers = xs.filter((v) => v >= lo && v <= hi);
  if (inliers.length === 0) return {};
  const min = inliers[0]!;
  const max = inliers[inliers.length - 1]!;
  const pad = (max - min) * 0.05 || Math.abs(max) * 0.05 || 1;
  return { min: min - pad, max: max + pad };
}
