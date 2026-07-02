import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type * as echarts from 'echarts';
import type { ActivityDetail as Detail, ActivitySample } from '@fitness/shared';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link, useParams } from 'react-router-dom';
import { analyzeActivity, fetchActivity, fetchActivitySamples, fetchAiSettings } from '../api';
import Chart from '../Chart';
import { bucketAverage } from '../chartHelpers';
import RouteMap from '../RouteMap';
import { formatDateTime, formatDuration, formatKm, formatNumber, formatPace, formatType } from '../format';

function Stat({ label, value }: { label: string; value: string }) {
  if (value === '—') return null;
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function HrZones({ a }: { a: Detail }) {
  const zones = [a.hrZone1S, a.hrZone2S, a.hrZone3S, a.hrZone4S, a.hrZone5S];
  if (zones.every((z) => z == null || z === 0)) return null;
  const total = zones.reduce((sum: number, z) => sum + (z ?? 0), 0);
  const colors = ['#7f8c9b', '#5fa8e6', '#5fce6e', '#e6b95f', '#e66a5f'];
  return (
    <section>
      <h3>Heart rate zones</h3>
      <div className="zones">
        {zones.map((z, i) => (
          <div key={i} className="zone-row">
            <span className="zone-label">Z{i + 1}</span>
            <div className="zone-track">
              <div
                className="zone-bar"
                style={{ width: `${total ? ((z ?? 0) / total) * 100 : 0}%`, background: colors[i] }}
              />
            </div>
            <span className="zone-time">
              {formatDuration(z ?? 0)} ({total ? Math.round(((z ?? 0) / total) * 100) : 0}%)
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Splits({ a }: { a: Detail }) {
  if (a.splits.length === 0) return null;
  const showDistance = a.splits.some((s) => (s.distanceM ?? 0) > 0);
  return (
    <section>
      <h3>Splits</h3>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Type</th>
            {showDistance && <th className="num">Distance</th>}
            <th className="num">Duration</th>
            {showDistance && <th className="num">Pace</th>}
            <th className="num">Avg HR</th>
            <th className="num">Max HR</th>
          </tr>
        </thead>
        <tbody>
          {a.splits.map((s) => (
            <tr key={s.splitIndex}>
              <td>{s.splitIndex + 1}</td>
              <td>{s.splitType?.replace(/_/g, ' ').toLowerCase() ?? '—'}</td>
              {showDistance && <td className="num">{s.distanceM ? formatKm(s.distanceM) : '—'}</td>}
              <td className="num">{formatDuration(s.durationS)}</td>
              {showDistance && <td className="num">{formatPace(s.avgSpeedMps)}</td>}
              <td className="num">{formatNumber(s.avgHr)}</td>
              <td className="num">{formatNumber(s.maxHr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function paceLabel(v: number): string {
  const mins = Math.floor(v);
  const secs = Math.round((v - mins) * 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function xVal(s: ActivitySample, i: number, hasDist: boolean): number {
  return hasDist && s.distanceM != null ? +(s.distanceM / 1000).toFixed(3) : i;
}

const DYNAMICS_MAX_POINTS = 600;

function findNearestSampleIdx(samples: ActivitySample[], xTarget: number, hasDist: boolean): number {
  if (samples.length === 0) return 0;
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const xMid = hasDist && samples[mid]!.distanceM != null ? samples[mid]!.distanceM! / 1000 : mid;
    if (xMid < xTarget) lo = mid + 1; else hi = mid;
  }
  if (lo > 0) {
    const xLo   = hasDist && samples[lo]!.distanceM   != null ? samples[lo]!.distanceM!   / 1000 : lo;
    const xPrev = hasDist && samples[lo-1]!.distanceM != null ? samples[lo-1]!.distanceM! / 1000 : lo - 1;
    if (Math.abs(xPrev - xTarget) < Math.abs(xLo - xTarget)) return lo - 1;
  }
  return lo;
}

function SamplesChart({ samples, type, onHighlight, mapHoveredIdx }: {
  samples: ActivitySample[];
  type: string | null;
  onHighlight?: (idx: number | null) => void;
  mapHoveredIdx?: number | null;
}) {
  const samplesRef = useRef(samples);
  samplesRef.current = samples;
  const hasDistRef = useRef(false);
  const mainChartRef     = useRef<import('echarts').ECharts>();
  const dynamicsChartRef = useRef<import('echarts').ECharts>();

  useEffect(() => {
    if (mapHoveredIdx == null) {
      mainChartRef.current?.dispatchAction({ type: 'hideTip' });
      dynamicsChartRef.current?.dispatchAction({ type: 'hideTip' });
      return;
    }
    mainChartRef.current?.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: mapHoveredIdx });
    // Dynamics series are bucket-averaged, so rescale the raw sample index.
    const n = samplesRef.current.length;
    const bucketSize = n > DYNAMICS_MAX_POINTS ? Math.ceil(n / DYNAMICS_MAX_POINTS) : 1;
    dynamicsChartRef.current?.dispatchAction({
      type: 'showTip',
      seriesIndex: 0,
      dataIndex: Math.floor(mapHoveredIdx / bucketSize),
    });
  }, [mapHoveredIdx]);

  if (samples.length === 0) return null;

  const isRun = type?.includes('running') ?? false;
  const hasDist = samples.some((s) => s.distanceM != null && s.distanceM > 0);
  hasDistRef.current = hasDist;
  const hasHr = samples.some((s) => s.heartRate != null);
  const hasSpeed = samples.some((s) => s.speedMps != null && s.speedMps >= 0.5);
  const hasAlt = samples.some((s) => s.altitudeM != null);
  const hasGct = isRun && samples.some((s) => s.groundContactMs != null);
  const hasCadence = samples.some((s) => s.cadence != null);

  const speedData = hasSpeed
    ? samples.map((s, i) => {
        const x = xVal(s, i, hasDist);
        if (s.speedMps == null || s.speedMps < 0.5) return [x, null];
        const v = isRun ? +(1000 / (s.speedMps * 60)).toFixed(3) : +(s.speedMps * 3.6).toFixed(2);
        return [x, v];
      })
    : [];
  const hrData = hasHr ? samples.map((s, i) => [xVal(s, i, hasDist), s.heartRate]) : [];
  const altData = hasAlt ? samples.map((s, i) => [xVal(s, i, hasDist), s.altitudeM]) : [];

  const xAxisLabel = (v: number) => (hasDist ? v.toFixed(1) : String(Math.round(v)));

  const mainOption: echarts.EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const ps = Array.isArray(params) ? params : [params];
        if (ps.length === 0) return '';
        const x = hasDist
          ? `${((ps[0]!.value as number[])[0]!).toFixed(2)} km`
          : `sample ${(ps[0]!.value as number[])[0]}`;
        const lines = ps
          .filter((p) => (p.value as number[])[1] != null)
          .map((p) => {
            const v = (p.value as number[])[1]!;
            let fv: string;
            const n = p.seriesName ?? '';
            if (n === 'Pace') fv = `${paceLabel(v)} /km`;
            else if (n === 'Speed') fv = `${v.toFixed(1)} km/h`;
            else if (n === 'HR') fv = `${Math.round(v)} bpm`;
            else fv = `${Math.round(v)} m`;
            return `<span style="color:${p.color as string}">${n}</span>: ${fv}`;
          });
        return `<div style="margin-bottom:4px">${x}</div>${lines.join('<br>')}`;
      },
    },
    legend: { type: 'scroll', top: 4, right: 8, left: 8, textStyle: { color: '#8a93a0', fontSize: 11 } },
    grid: { containLabel: true, left: 8, right: 8, top: 44, bottom: 44 },
    xAxis: {
      type: 'value',
      name: hasDist ? 'km' : '',
      nameLocation: 'end',
      axisLabel: { formatter: xAxisLabel },
      splitLine: { lineStyle: { color: '#2a3038' } },
    },
    yAxis: [
      {
        type: 'value',
        inverse: isRun,
        axisLabel: {
          formatter: isRun ? paceLabel : (v: number) => v.toFixed(0),
          color: '#5fa8e6',
        },
        splitLine: { lineStyle: { color: '#2a3038' } },
      },
      {
        type: 'value',
        axisLabel: { formatter: (v: number) => String(Math.round(v)), color: '#e66a5f' },
        splitLine: { show: false },
      },
      ...(hasAlt ? [{ type: 'value' as const, show: false }] : []),
    ],
    dataZoom: [
      { type: 'inside', throttle: 50 },
      { type: 'slider', height: 18, bottom: 8 },
    ],
    series: [
      ...(hasSpeed
        ? [
            {
              type: 'line' as const,
              name: isRun ? 'Pace' : 'Speed',
              data: speedData,
              yAxisIndex: 0,
              showSymbol: false,
              connectNulls: false,
              lineStyle: { width: 1.5, color: '#5fa8e6' },
              itemStyle: { color: '#5fa8e6' },
            },
          ]
        : []),
      ...(hasHr
        ? [
            {
              type: 'line' as const,
              name: 'HR',
              data: hrData,
              yAxisIndex: 1,
              showSymbol: false,
              connectNulls: false,
              lineStyle: { width: 1.5, color: '#e66a5f' },
              itemStyle: { color: '#e66a5f' },
            },
          ]
        : []),
      ...(hasAlt
        ? [
            {
              type: 'line' as const,
              name: 'Altitude',
              data: altData,
              yAxisIndex: 2,
              showSymbol: false,
              connectNulls: false,
              areaStyle: { color: 'rgba(95, 206, 110, 0.12)' },
              lineStyle: { width: 1, color: 'rgba(95, 206, 110, 0.35)' },
              itemStyle: { color: '#5fce6e' },
              z: 1,
            },
          ]
        : []),
    ],
  };

  const hasBalance = isRun && samples.some((s) => s.groundContactBalanceLeft != null);
  const gctData     = hasGct     ? bucketAverage(samples.map((s, i) => [xVal(s, i, hasDist), s.groundContactMs]), DYNAMICS_MAX_POINTS)         : [];
  const cadData     = hasCadence ? bucketAverage(samples.map((s, i) => [xVal(s, i, hasDist), s.cadence]), DYNAMICS_MAX_POINTS)                  : [];
  const balData     = hasBalance ? bucketAverage(samples.map((s, i) => [xVal(s, i, hasDist), s.groundContactBalanceLeft]), DYNAMICS_MAX_POINTS) : [];

  const dynamicsOption: echarts.EChartsOption | null =
    hasGct || hasCadence || hasBalance
      ? {
          backgroundColor: 'transparent',
          tooltip: { trigger: 'axis' },
          legend: { type: 'scroll', top: 4, right: 8, left: 8, textStyle: { color: '#8a93a0', fontSize: 11 } },
          grid: { containLabel: true, left: 8, right: 8, top: 44, bottom: 44 },
          xAxis: {
            type: 'value',
            name: hasDist ? 'km' : '',
            nameLocation: 'end',
            axisLabel: { formatter: xAxisLabel },
            splitLine: { lineStyle: { color: '#2a3038' } },
          },
          yAxis: [
            ...(hasGct ? [{
              type: 'value' as const,
              axisLabel: { color: '#e6b95f', formatter: (v: number) => `${Math.round(v)}` },
              splitLine: { lineStyle: { color: '#2a3038' } },
            }] : [{ type: 'value' as const, show: false }]),
            ...(hasCadence ? [{
              type: 'value' as const,
              axisLabel: { color: '#b87fff' },
              splitLine: { show: false },
            }] : [{ type: 'value' as const, show: false }]),
            ...(hasBalance ? [{
              type: 'value' as const,
              min: 45,
              max: 55,
              axisLabel: { color: '#5fce6e', formatter: (v: number) => `${v}%` },
              splitLine: { show: false },
            }] : []),
          ],
          dataZoom: [
            { type: 'inside', throttle: 50 },
            { type: 'slider', height: 18, bottom: 8 },
          ],
          series: [
            ...(hasGct
              ? [
                  {
                    type: 'line' as const,
                    name: 'Ground contact',
                    data: gctData,
                    yAxisIndex: 0,
                    showSymbol: false,
                    connectNulls: false,
                    lineStyle: { width: 1.5, color: '#e6b95f' },
                    itemStyle: { color: '#e6b95f' },
                  },
                ]
              : []),
            ...(hasCadence
              ? [
                  {
                    type: 'line' as const,
                    name: 'Cadence',
                    data: cadData,
                    yAxisIndex: 1,
                    showSymbol: false,
                    connectNulls: false,
                    lineStyle: { width: 1.5, color: '#b87fff' },
                    itemStyle: { color: '#b87fff' },
                  },
                ]
              : []),
            ...(hasBalance
              ? [
                  {
                    type: 'line' as const,
                    name: 'L/R balance',
                    data: balData,
                    yAxisIndex: 2,
                    showSymbol: false,
                    connectNulls: false,
                    lineStyle: { width: 1.5, color: '#5fce6e' },
                    itemStyle: { color: '#5fce6e' },
                  },
                ]
              : []),
          ],
        }
      : null;

  const makeChartReady = (chartRef: React.MutableRefObject<import('echarts').ECharts | undefined>) =>
    (chart: import('echarts').ECharts) => {
      chartRef.current = chart;
      if (!onHighlight) return;
      chart.getZr().on('mousemove', (e: { offsetX: number; offsetY: number }) => {
        const pt = chart.convertFromPixel({ seriesIndex: 0 }, [e.offsetX, e.offsetY]) as [number, number] | null;
        if (pt == null) return;
        const idx = findNearestSampleIdx(samplesRef.current, pt[0], hasDistRef.current);
        onHighlight(idx);
      });
      chart.getZr().on('mouseout', () => onHighlight(null));
    };

  return (
    <>
      <section>
        <h3>Activity chart</h3>
        <Chart option={mainOption} height={280} onReady={makeChartReady(mainChartRef)} />
      </section>
      {dynamicsOption && (
        <section>
          <h3>Running form</h3>
          <Chart option={dynamicsOption} height={220} onReady={makeChartReady(dynamicsChartRef)} />
        </section>
      )}
    </>
  );
}

function AiAnalysis({ activityId }: { activityId: string }) {
  const settings = useQuery({ queryKey: ['ai-settings'], queryFn: fetchAiSettings });
  const [question, setQuestion] = useState('');
  const [model, setModel] = useState('');

  const run = useMutation({
    mutationFn: () =>
      analyzeActivity(activityId, {
        question: question.trim() || undefined,
        model: model || undefined,
      }),
  });

  const models = settings.data?.analysis.models.filter((m) => m.trim() !== '') ?? [];
  const active = model || settings.data?.analysis.selected || '';

  return (
    <section>
      <h3>AI analysis</h3>
      <div className="controls">
        <input
          value={question}
          placeholder="optional question, e.g. why did my HR drift?"
          style={{ minWidth: 320 }}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <select value={active} onChange={(e) => setModel(e.target.value)}>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? 'Analysing…' : 'Analyse'}
        </button>
      </div>
      {run.error && <p className="status">Failed: {(run.error as Error).message}</p>}
      {run.data && (
        <div className="chat-md">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{run.data.analysis}</ReactMarkdown>
          <p className="status">model: {run.data.model}</p>
        </div>
      )}
    </section>
  );
}

export default function ActivityDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: a, isPending, error } = useQuery({
    queryKey: ['activity', id],
    queryFn: () => fetchActivity(id!),
    enabled: !!id,
  });
  const { data: samples = [] } = useQuery({
    queryKey: ['activity-samples', id],
    queryFn: () => fetchActivitySamples(id!),
    enabled: !!id,
  });

  const [highlightedIdx, setHighlightedIdx] = useState<number | null>(null);
  const [mapHoveredIdx,  setMapHoveredIdx]  = useState<number | null>(null);

  if (isPending) return <p className="status">Loading…</p>;
  if (error) return <p className="status">Failed to load: {(error as Error).message}</p>;
  if (!a) return null;

  const isRun = a.type?.includes('running') ?? false;

  return (
    <>
      <p>
        <Link to="/activities">← activities</Link>
        {' · '}
        <Link to={`/compare?a=${a.activityId}${a.type ? `&type=${encodeURIComponent(a.type)}` : ''}`}>
          compare…
        </Link>
      </p>
      <h2>{a.name ?? '(unnamed)'}</h2>
      <p className="status">
        {formatType(a.type)} · {formatDateTime(a.startTimeLocal)}
      </p>

      <div className="stat-grid">
        <Stat label="Distance" value={a.distanceM ? formatKm(a.distanceM) : '—'} />
        <Stat label="Duration" value={formatDuration(a.durationS)} />
        <Stat label={isRun ? 'Avg pace' : 'Avg speed'} value={
          isRun
            ? formatPace(a.avgSpeedMps)
            : a.avgSpeedMps != null
              ? `${(a.avgSpeedMps * 3.6).toFixed(1)} km/h`
              : '—'
        } />
        <Stat label="Avg HR" value={formatNumber(a.avgHr, ' bpm')} />
        <Stat label="Max HR" value={formatNumber(a.maxHr, ' bpm')} />
        <Stat label="Elevation gain" value={formatNumber(a.elevationGainM, ' m')} />
        <Stat label="Calories" value={formatNumber(a.calories)} />
        <Stat label="Training load" value={formatNumber(a.trainingLoad)} />
        <Stat label="Aerobic TE" value={formatNumber(a.aerobicTe, '', 1)} />
        <Stat label="Anaerobic TE" value={formatNumber(a.anaerobicTe, '', 1)} />
        <Stat label="VO2max" value={formatNumber(a.vo2max, '', 1)} />
        <Stat label="Avg cadence" value={formatNumber(a.avgCadence, ' spm')} />
        <Stat label="Avg power" value={formatNumber(a.avgPower, ' W')} />
        <Stat label="Norm power" value={formatNumber(a.normPower, ' W')} />
        <Stat label="Fastest km" value={a.fastestKmS ? formatDuration(a.fastestKmS) : '—'} />
        <Stat label="Fastest 5k" value={a.fastest5kS ? formatDuration(a.fastest5kS) : '—'} />
        <Stat label="Steps" value={formatNumber(a.activitySteps)} />
        <Stat label="Body battery" value={a.bodyBatteryDelta != null ? `${a.bodyBatteryDelta > 0 ? '+' : ''}${a.bodyBatteryDelta}` : '—'} />
        <Stat label="Avg respiration" value={formatNumber(a.avgRespirationRate, ' brpm', 1)} />
        <Stat label="Avg temp" value={formatNumber(a.tempAvgC, ' °C', 1)} />
        <Stat label="Sweat loss" value={formatNumber(a.waterEstimatedMl, ' ml')} />
        <Stat
          label="Stamina"
          value={
            a.staminaStart != null && a.staminaEnd != null
              ? `${a.staminaStart}% → ${a.staminaEnd}%`
              : '—'
          }
        />
      </div>

      {(a.groundContactMs != null || a.strideLengthCm != null) && (
        <section>
          <h3>Running dynamics</h3>
          <div className="stat-grid">
            <Stat label="Ground contact" value={formatNumber(a.groundContactMs, ' ms')} />
            <Stat
              label="L/R balance"
              value={
                a.groundContactBalanceLeft != null
                  ? `${a.groundContactBalanceLeft.toFixed(1)}% L / ${(100 - a.groundContactBalanceLeft).toFixed(1)}% R`
                  : '—'
              }
            />
            <Stat label="Vertical oscillation" value={formatNumber(a.verticalOscillationCm, ' cm', 1)} />
            <Stat label="Vertical ratio" value={formatNumber(a.verticalRatioPct, ' %', 1)} />
            <Stat
              label="Stride length"
              value={a.strideLengthCm != null ? `${(a.strideLengthCm / 100).toFixed(2)} m` : '—'}
            />
          </div>
        </section>
      )}

      <SamplesChart samples={samples} type={a.type} onHighlight={setHighlightedIdx} mapHoveredIdx={mapHoveredIdx} />
      <RouteMap samples={samples} highlightedSampleIdx={highlightedIdx} onMapHover={setMapHoveredIdx} />
      <HrZones a={a} />
      <Splits a={a} />
      <AiAnalysis activityId={a.activityId} />
    </>
  );
}
