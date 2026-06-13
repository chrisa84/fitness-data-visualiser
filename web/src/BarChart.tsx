import * as echarts from 'echarts';
import { useEffect, useRef } from 'react';

interface Props {
  title: string;
  unit?: string;
  categories: string[];
  values: (number | null)[];
  color?: string;
  /** Extra lines appended to the tooltip per data index. */
  tooltipExtra?: (index: number) => string[];
}

export default function BarChart({
  title,
  unit,
  categories,
  values,
  color = '#5fce6e',
  tooltipExtra,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts>();

  useEffect(() => {
    const container = containerRef.current!;
    const chart = echarts.init(container);
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(
      {
        backgroundColor: 'transparent',
        title: { text: title, textStyle: { color: '#e6e8eb', fontSize: 14 } },
        tooltip: {
          trigger: 'axis',
          formatter: (params: { dataIndex: number; name: string; value: number | null }[]) => {
            const p = params[0];
            if (!p) return '';
            const lines = [`<b>${p.name}</b>`, `${p.value ?? '—'}${unit ? ` ${unit}` : ''}`];
            if (tooltipExtra) lines.push(...tooltipExtra(p.dataIndex));
            return lines.join('<br/>');
          },
        },
        grid: { left: 55, right: 20, top: 40, bottom: 70 },
        xAxis: { type: 'category', data: categories },
        yAxis: { type: 'value', splitLine: { lineStyle: { color: '#2a3038' } } },
        dataZoom: [
          { type: 'inside', throttle: 50 },
          { type: 'slider', height: 24, bottom: 10 },
        ],
        series: [{ type: 'bar', name: title, itemStyle: { color }, data: values }],
      },
      { notMerge: true },
    );
  }, [title, unit, categories, values, color, tooltipExtra]);

  return <div ref={containerRef} style={{ width: '100%', height: 420 }} />;
}
