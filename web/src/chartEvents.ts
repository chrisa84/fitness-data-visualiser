import type * as echarts from 'echarts';

/**
 * Appends an event overlay series to every chart option in a list. All options
 * must share the same category x-axis dates (true for the Dashboard and
 * Performance pages, which build one date axis for all their charts).
 */
export function appendEvents(
  options: echarts.EChartsOption[],
  eventSeries: echarts.LineSeriesOption | null,
): echarts.EChartsOption[] {
  if (!eventSeries) return options;
  return options.map((option) => {
    const existing = (option.series ?? []) as echarts.SeriesOption[];
    return { ...option, series: [...existing, eventSeries] };
  });
}
