import * as echarts from 'echarts';
import { useEffect, useRef } from 'react';

interface Props {
  option: echarts.EChartsOption;
  height?: number;
}

/** Thin ECharts wrapper: init once, re-apply option on change, resize with container. */
export default function Chart({ option, height = 320 }: Props) {
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
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
