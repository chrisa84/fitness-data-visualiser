import * as echarts from 'echarts';
import { useEffect, useRef } from 'react';

interface Props {
  option: echarts.EChartsOption;
  height?: number;
  onReady?: (chart: echarts.ECharts) => void;
}

/** Thin ECharts wrapper: init once, re-apply option on change, resize with container. */
export default function Chart({ option, height = 320, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts>();
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const container = containerRef.current!;
    const chart = echarts.init(container);
    chartRef.current = chart;
    onReadyRef.current?.(chart);
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
