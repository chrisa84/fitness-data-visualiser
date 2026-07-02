import { useQuery } from '@tanstack/react-query';
import type * as echarts from 'echarts';
import type { ActivityDetail, ActivityListItem, ActivitySample } from '@fitness/shared';
import { activityGroupOptionValue } from '@fitness/shared';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchActivities, fetchActivity, fetchActivitySamples, fetchActivityTypes } from '../api';
import Chart from '../Chart';
import { bucketAverage } from '../chartHelpers';
import { formatDateTime, formatDuration, formatKm, formatNumber, formatPace } from '../format';
import { buildTypeOptions } from '../typeOptions';

const A_COLOR = '#5fa8e6';
const B_COLOR = '#e6b95f';
const MAX_POINTS = 800;

function paceTick(v: number): string {
  const mins = Math.floor(v);
  const secs = Math.round((v - mins) * 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/** [distance km, value] pairs for one metric of one run, bucket-averaged. */
function series(
  samples: ActivitySample[],
  pick: (s: ActivitySample) => number | null,
): (number | null)[][] {
  const raw = samples
    .filter((s) => s.distanceM != null)
    .map((s) => [+((s.distanceM as number) / 1000).toFixed(3), pick(s)]);
  return bucketAverage(raw, MAX_POINTS);
}

function overlayOption(
  title: string,
  aName: string,
  bName: string,
  aData: (number | null)[][],
  bData: (number | null)[][],
  opts: { inverse?: boolean; paceAxis?: boolean } = {},
): echarts.EChartsOption {
  return {
    backgroundColor: 'transparent',
    title: { text: title, textStyle: { color: '#e6e8eb', fontSize: 13 }, left: 0, top: 4 },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v: unknown) =>
        v == null ? '—' : opts.paceAxis ? `${paceTick(v as number)} /km` : String(v),
    },
    legend: { type: 'scroll', top: 26, right: 8, left: 8, textStyle: { color: '#8a93a0', fontSize: 11 } },
    grid: { containLabel: true, left: 8, right: 16, top: 58, bottom: 44 },
    xAxis: {
      type: 'value',
      name: 'km',
      nameLocation: 'end',
      axisLabel: { formatter: (v: number) => v.toFixed(1) },
      splitLine: { lineStyle: { color: '#2a3038' } },
    },
    yAxis: {
      type: 'value',
      scale: true,
      inverse: opts.inverse ?? false,
      axisLabel: opts.paceAxis ? { formatter: paceTick } : {},
      splitLine: { lineStyle: { color: '#2a3038' } },
    },
    dataZoom: [
      { type: 'inside', throttle: 50 },
      { type: 'slider', height: 18, bottom: 8 },
    ],
    series: [
      {
        type: 'line',
        name: aName,
        data: aData,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1.5, color: A_COLOR },
        itemStyle: { color: A_COLOR },
      },
      {
        type: 'line',
        name: bName,
        data: bData,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1.5, color: B_COLOR },
        itemStyle: { color: B_COLOR },
      },
    ],
  };
}

function diffRows(a: ActivityDetail, b: ActivityDetail): { label: string; a: string; b: string }[] {
  const rows: { label: string; a: string; b: string }[] = [
    { label: 'Date', a: formatDateTime(a.startTimeLocal), b: formatDateTime(b.startTimeLocal) },
    { label: 'Distance', a: a.distanceM ? formatKm(a.distanceM) : '—', b: b.distanceM ? formatKm(b.distanceM) : '—' },
    { label: 'Duration', a: formatDuration(a.durationS), b: formatDuration(b.durationS) },
    { label: 'Avg pace', a: formatPace(a.avgSpeedMps), b: formatPace(b.avgSpeedMps) },
    { label: 'Avg HR', a: formatNumber(a.avgHr, ' bpm'), b: formatNumber(b.avgHr, ' bpm') },
    { label: 'Max HR', a: formatNumber(a.maxHr, ' bpm'), b: formatNumber(b.maxHr, ' bpm') },
    { label: 'Avg cadence', a: formatNumber(a.avgCadence, ' spm'), b: formatNumber(b.avgCadence, ' spm') },
    { label: 'Elevation gain', a: formatNumber(a.elevationGainM, ' m'), b: formatNumber(b.elevationGainM, ' m') },
    { label: 'Training load', a: formatNumber(a.trainingLoad), b: formatNumber(b.trainingLoad) },
    { label: 'Aerobic TE', a: formatNumber(a.aerobicTe, '', 1), b: formatNumber(b.aerobicTe, '', 1) },
    { label: 'Fastest km', a: a.fastestKmS ? formatDuration(a.fastestKmS) : '—', b: b.fastestKmS ? formatDuration(b.fastestKmS) : '—' },
    { label: 'Fastest 5k', a: a.fastest5kS ? formatDuration(a.fastest5kS) : '—', b: b.fastest5kS ? formatDuration(b.fastest5kS) : '—' },
    { label: 'Ground contact', a: formatNumber(a.groundContactMs, ' ms'), b: formatNumber(b.groundContactMs, ' ms') },
    { label: 'Vertical oscillation', a: formatNumber(a.verticalOscillationCm, ' cm', 1), b: formatNumber(b.verticalOscillationCm, ' cm', 1) },
  ];
  return rows.filter((r) => r.a !== '—' || r.b !== '—');
}

function pickLabel(
  item: { startTimeLocal: string | null; name: string | null; distanceM: number | null } | undefined,
  fallback: string,
): string {
  if (!item) return fallback;
  const date = item.startTimeLocal?.slice(0, 10) ?? '?';
  const dist = item.distanceM ? ` · ${formatKm(item.distanceM)}` : '';
  return `${date} — ${item.name ?? '(unnamed)'}${dist}`;
}

export default function Compare() {
  const [searchParams, setSearchParams] = useSearchParams();
  const type = searchParams.get('type') ?? activityGroupOptionValue('running');
  const aId = searchParams.get('a') ?? '';
  const bId = searchParams.get('b') ?? '';
  const q = searchParams.get('q') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const minKm = searchParams.get('minKm') ?? '';
  const maxKm = searchParams.get('maxKm') ?? '';
  const similar = searchParams.get('similar') === '1';
  const [pickerOpen, setPickerOpen] = useState(!aId || !bId);
  // Search box is applied on enter/blur so typing doesn't fire a query per key.
  const [qDraft, setQDraft] = useState(q);

  const setParam = (key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  };

  const types = useQuery({ queryKey: ['activity-types'], queryFn: fetchActivityTypes });

  const a = useQuery({ queryKey: ['activity', aId], queryFn: () => fetchActivity(aId), enabled: !!aId });
  const b = useQuery({ queryKey: ['activity', bId], queryFn: () => fetchActivity(bId), enabled: !!bId });
  const aSamples = useQuery({
    queryKey: ['activity-samples', aId],
    queryFn: () => fetchActivitySamples(aId),
    enabled: !!aId,
  });
  const bSamples = useQuery({
    queryKey: ['activity-samples', bId],
    queryFn: () => fetchActivitySamples(bId),
    enabled: !!bId,
  });

  // "Similar to A" narrows the picker list to ±10% of A's distance.
  const simBand =
    similar && a.data?.distanceM
      ? {
          minKm: +((a.data.distanceM / 1000) * 0.9).toFixed(2),
          maxKm: +((a.data.distanceM / 1000) * 1.1).toFixed(2),
        }
      : null;

  const list = useQuery({
    queryKey: ['compare-activities', { type, q, from, to, minKm, maxKm, simBand }],
    queryFn: () =>
      fetchActivities({
        type: type || undefined,
        q: q || undefined,
        from: from || undefined,
        to: to || undefined,
        minKm: simBand ? simBand.minKm : minKm ? Number(minKm) : undefined,
        maxKm: simBand ? simBand.maxKm : maxKm ? Number(maxKm) : undefined,
        sort: 'start_time',
        order: 'desc',
        limit: 200,
      }),
    placeholderData: (prev) => prev,
    enabled: pickerOpen,
  });

  const pick = (slot: 'a' | 'b', id: string) => {
    setParam(slot, id);
    const other = slot === 'a' ? bId : aId;
    if (other) setPickerOpen(false);
  };

  const charts = useMemo(() => {
    if (!a.data || !b.data) return null;
    const sa = aSamples.data ?? [];
    const sb = bSamples.data ?? [];
    const aName = `A · ${a.data.startTimeLocal?.slice(0, 10) ?? ''}`;
    const bName = `B · ${b.data.startTimeLocal?.slice(0, 10) ?? ''}`;
    const out: echarts.EChartsOption[] = [];
    const hasSpeed = (s: ActivitySample[]) => s.some((x) => x.speedMps != null && x.speedMps >= 0.5);
    if (hasSpeed(sa) && hasSpeed(sb)) {
      const pace = (x: ActivitySample) =>
        x.speedMps == null || x.speedMps < 0.5 ? null : +(1000 / (x.speedMps * 60)).toFixed(3);
      out.push(
        overlayOption('Pace (min/km)', aName, bName, series(sa, pace), series(sb, pace), {
          inverse: true,
          paceAxis: true,
        }),
      );
    }
    const hasHr = (s: ActivitySample[]) => s.some((x) => x.heartRate != null);
    if (hasHr(sa) && hasHr(sb)) {
      out.push(
        overlayOption(
          'Heart rate (bpm)',
          aName,
          bName,
          series(sa, (x) => x.heartRate),
          series(sb, (x) => x.heartRate),
        ),
      );
    }
    return out;
  }, [a.data, b.data, aSamples.data, bSamples.data]);

  return (
    <>
      <h2>Compare activities</h2>
      <div className="controls">
        <span style={{ color: A_COLOR }}>A: {pickLabel(a.data, 'not picked')}</span>
        <span style={{ color: B_COLOR }}>B: {pickLabel(b.data, 'not picked')}</span>
        <button onClick={() => setPickerOpen((v) => !v)}>
          {pickerOpen ? 'hide picker' : 'change…'}
        </button>
      </div>

      {pickerOpen && (
        <>
          <div className="controls">
            <select value={type} onChange={(e) => setParam('type', e.target.value)}>
              <option value="">all types</option>
              {buildTypeOptions(types.data).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              placeholder="search name…"
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              onBlur={() => setParam('q', qDraft)}
              onKeyDown={(e) => e.key === 'Enter' && setParam('q', qDraft)}
            />
            <label>
              from <input type="date" value={from} onChange={(e) => setParam('from', e.target.value)} />
            </label>
            <label>
              to <input type="date" value={to} onChange={(e) => setParam('to', e.target.value)} />
            </label>
            <label>
              min km{' '}
              <input
                type="number"
                min={0}
                style={{ width: 60 }}
                value={minKm}
                disabled={similar}
                onChange={(e) => setParam('minKm', e.target.value)}
              />
            </label>
            <label>
              max km{' '}
              <input
                type="number"
                min={0}
                style={{ width: 60 }}
                value={maxKm}
                disabled={similar}
                onChange={(e) => setParam('maxKm', e.target.value)}
              />
            </label>
            {aId && (
              <label>
                <input
                  type="checkbox"
                  checked={similar}
                  onChange={(e) => setParam('similar', e.target.checked ? '1' : '')}
                />{' '}
                similar distance to A (±10%)
              </label>
            )}
          </div>
          <table>
            <thead>
              <tr>
                <th>pick</th>
                <th>date</th>
                <th>name</th>
                <th>distance</th>
                <th>pace</th>
                <th>avg HR</th>
              </tr>
            </thead>
            <tbody>
              {(list.data?.items ?? []).map((item) => (
                <tr key={item.activityId}>
                  <td>
                    <button
                      onClick={() => pick('a', item.activityId)}
                      style={item.activityId === aId ? { color: A_COLOR, fontWeight: 700 } : undefined}
                    >
                      A
                    </button>{' '}
                    <button
                      onClick={() => pick('b', item.activityId)}
                      style={item.activityId === bId ? { color: B_COLOR, fontWeight: 700 } : undefined}
                    >
                      B
                    </button>
                  </td>
                  <td>{formatDateTime(item.startTimeLocal)}</td>
                  <td>
                    <Link to={`/activities/${item.activityId}`}>{item.name ?? '(unnamed)'}</Link>
                  </td>
                  <td className="num">{item.distanceM ? formatKm(item.distanceM) : '—'}</td>
                  <td className="num">{formatPace(item.avgSpeedMps)}</td>
                  <td className="num">{formatNumber(item.avgHr, ' bpm')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data && list.data.total > list.data.items.length && (
            <p className="status">
              Showing latest {list.data.items.length} of {list.data.total} — narrow the filters to
              find older activities.
            </p>
          )}
          {list.data && list.data.items.length === 0 && (
            <p className="status">No activities match these filters.</p>
          )}
        </>
      )}

      {(!aId || !bId) && !pickerOpen && (
        <p className="status">Pick two activities to compare.</p>
      )}
      {(a.error || b.error) && (
        <p className="status">Failed to load: {((a.error ?? b.error) as Error).message}</p>
      )}

      {a.data && b.data && (
        <>
          <table>
            <thead>
              <tr>
                <th></th>
                <th style={{ color: A_COLOR }}>
                  <Link to={`/activities/${aId}`}>{a.data.name ?? 'A'}</Link>
                </th>
                <th style={{ color: B_COLOR }}>
                  <Link to={`/activities/${bId}`}>{b.data.name ?? 'B'}</Link>
                </th>
              </tr>
            </thead>
            <tbody>
              {diffRows(a.data, b.data).map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className="num">{r.a}</td>
                  <td className="num">{r.b}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {charts?.map((option, i) => <Chart key={i} option={option} height={300} />)}
          {charts && charts.length === 0 && (
            <p className="status">No overlapping sample data (speed/HR) to chart for these two.</p>
          )}
        </>
      )}
    </>
  );
}
