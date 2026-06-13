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

export const secondsToHours = (s: number | null) =>
  s == null ? null : Math.round((s / 3600) * 100) / 100;
