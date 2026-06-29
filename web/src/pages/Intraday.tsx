import { useQuery } from '@tanstack/react-query';
import type * as echarts from 'echarts';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchIntraday } from '../api';
import Chart from '../Chart';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function timeAxis(): echarts.XAXisComponentOption {
  return {
    type: 'time',
    axisLabel: { color: '#8a93a0', fontSize: 11, formatter: '{HH}:{mm}' },
    splitLine: { lineStyle: { color: '#2a3038' } },
  };
}

function valueAxis(name: string): echarts.YAXisComponentOption {
  return {
    type: 'value',
    name,
    nameTextStyle: { color: '#8a93a0', fontSize: 11 },
    scale: true,
    axisLabel: { color: '#8a93a0', fontSize: 11 },
    splitLine: { lineStyle: { color: '#2a3038' } },
  };
}

function baseTimeOption(title: string): Partial<echarts.EChartsOption> {
  return {
    backgroundColor: 'transparent',
    title: { text: title, textStyle: { color: '#e6e8eb', fontSize: 13 }, left: 0, top: 4 },
    tooltip: { trigger: 'axis' },
    grid: { left: 56, right: 16, top: 40, bottom: 56 },
    dataZoom: [
      { type: 'inside', throttle: 50 },
      { type: 'slider', height: 18, bottom: 8 },
    ],
  };
}

export default function Intraday() {
  const [searchParams, setSearchParams] = useSearchParams();
  const date = searchParams.get('date') ?? todayIso();

  const setDate = (d: string) => {
    setSearchParams({ date: d });
  };

  const { data, isPending, error } = useQuery({
    queryKey: ['intraday', date],
    queryFn: () => fetchIntraday(date),
    placeholderData: (prev) => prev,
  });

  const hrOption = useMemo((): echarts.EChartsOption => {
    const pts = (data?.heartRate ?? []).map((p) => [p.timestampUtc, p.heartRate]);
    return {
      ...baseTimeOption('Heart rate'),
      xAxis: timeAxis(),
      yAxis: valueAxis('bpm'),
      series: [
        {
          type: 'line',
          data: pts,
          showSymbol: false,
          connectNulls: false,
          lineStyle: { width: 1.5, color: '#e05f5f' },
          itemStyle: { color: '#e05f5f' },
        },
      ],
    };
  }, [data?.heartRate]);

  const stressOption = useMemo((): echarts.EChartsOption => {
    const pts = (data?.stress ?? []).map((p) => [p.timestampUtc, p.stressLevel]);
    return {
      ...baseTimeOption('Stress'),
      xAxis: timeAxis(),
      yAxis: { ...valueAxis(''), min: 0, max: 100 },
      series: [
        {
          type: 'line',
          data: pts,
          showSymbol: false,
          connectNulls: false,
          lineStyle: { width: 1.5, color: '#f5a623' },
          itemStyle: { color: '#f5a623' },
          areaStyle: { color: 'rgba(245,166,35,0.1)' },
        },
      ],
    };
  }, [data?.stress]);

  const stepsOption = useMemo((): echarts.EChartsOption => {
    const pts = (data?.steps ?? []).map((p) => [p.timestampUtc, p.steps]);
    return {
      ...baseTimeOption('Steps (15-min blocks)'),
      xAxis: timeAxis(),
      yAxis: valueAxis('steps'),
      series: [
        {
          type: 'bar',
          data: pts,
          itemStyle: { color: '#5fce6e' },
          barWidth: '80%',
        },
      ],
    };
  }, [data?.steps]);

  const respirationOption = useMemo((): echarts.EChartsOption => {
    const pts = (data?.respiration ?? []).map((p) => [p.timestampUtc, p.breathsPerMin]);
    return {
      ...baseTimeOption('Respiration'),
      xAxis: timeAxis(),
      yAxis: valueAxis('brpm'),
      series: [
        {
          type: 'line',
          data: pts,
          showSymbol: false,
          connectNulls: false,
          lineStyle: { width: 1.5, color: '#5fa8e0' },
          itemStyle: { color: '#5fa8e0' },
        },
      ],
    };
  }, [data?.respiration]);

  const empty =
    data &&
    data.heartRate.length === 0 &&
    data.stress.length === 0 &&
    data.steps.length === 0 &&
    data.respiration.length === 0;

  return (
    <div className="page">
      <div className="controls">
        <label htmlFor="intraday-date">Date</label>
        <input
          id="intraday-date"
          type="date"
          value={date}
          max={todayIso()}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      {isPending && <p className="loading">Loading…</p>}
      {error && <p className="error">{String(error)}</p>}

      {empty && <p className="empty">No intraday data for {date}.</p>}

      {data && data.heartRate.length > 0 && <Chart option={hrOption} height={260} />}
      {data && data.stress.length > 0 && <Chart option={stressOption} height={260} />}
      {data && data.steps.length > 0 && <Chart option={stepsOption} height={260} />}
      {data && data.respiration.length > 0 && <Chart option={respirationOption} height={260} />}
    </div>
  );
}
