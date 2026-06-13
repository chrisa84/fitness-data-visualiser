import { useQuery } from '@tanstack/react-query';
import type * as echarts from 'echarts';
import type { CalendarEvent, EventType } from '@fitness/shared';
import { fetchEvents } from './api';

export const EVENT_COLORS: Record<EventType, string> = {
  race: '#e6c15f',
  injury: '#e66a5f',
  illness: '#e6915f',
  medication: '#5fa8e6',
  life: '#9b7fd4',
  travel: '#5fce6e',
  note: '#8a93a0',
};

export function useEvents() {
  return useQuery({ queryKey: ['events'], queryFn: () => fetchEvents() });
}

/** Index of the bucket an ISO date falls into: last category <= date, or -1. */
function bucketIndex(dates: string[], date: string): number {
  let idx = -1;
  for (let i = 0; i < dates.length; i += 1) {
    if (dates[i]! <= date) idx = i;
    else break;
  }
  return idx;
}

function markLineAt(idx: number, color: string, label: string) {
  return {
    xAxis: idx,
    lineStyle: { color, width: 1, type: 'dashed' as const },
    label: { show: true, formatter: label, color, fontSize: 10, rotate: 90, position: 'insideEndTop' as const },
  };
}

/**
 * Builds a silent ECharts series carrying the events as vertical marklines
 * (point events) and shaded markareas (ranged events) aligned to a category
 * x-axis. Returns null when nothing falls in range. Attach to any chart that
 * shares the same `dates`.
 *
 * Ranged events also get a marker line at their start so that short ranges
 * (e.g. a week-long illness over a multi-year axis) stay visible rather than
 * collapsing to a sub-pixel band. Ranges entered end-before-start are
 * tolerated, and events that fall entirely outside the data window are skipped.
 */
export function buildEventSeries(
  events: CalendarEvent[] | undefined,
  dates: string[],
): echarts.LineSeriesOption | null {
  if (!events || events.length === 0 || dates.length === 0) return null;
  const last = dates.length - 1;
  const first = dates[0]!;
  const lastDate = dates[last]!;

  const markLineData: object[] = [];
  const markAreaData: object[][] = [];

  for (const e of events) {
    const color = EVENT_COLORS[e.type];
    if (e.endDate) {
      let start = e.date;
      let end = e.endDate;
      if (end < start) [start, end] = [end, start];
      if (end < first || start > lastDate) continue; // entirely outside the data
      const startIdx = Math.max(bucketIndex(dates, start), 0);
      const endIdx = Math.min(Math.max(bucketIndex(dates, end), 0), last);
      markAreaData.push([
        { xAxis: startIdx, itemStyle: { color: `${color}33` } },
        { xAxis: endIdx },
      ]);
      markLineData.push(markLineAt(startIdx, color, e.label));
    } else {
      if (e.date < first || e.date > lastDate) continue; // outside the data
      markLineData.push(markLineAt(bucketIndex(dates, e.date), color, e.label));
    }
  }

  if (markLineData.length === 0 && markAreaData.length === 0) return null;

  return {
    type: 'line',
    name: 'events',
    data: [],
    silent: true,
    markLine: { symbol: 'none', data: markLineData as never },
    markArea: { silent: true, data: markAreaData as never },
  };
}
