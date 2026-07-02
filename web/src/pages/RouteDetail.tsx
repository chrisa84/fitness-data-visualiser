import { useQuery } from '@tanstack/react-query';
import type * as echarts from 'echarts';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchRouteClusterDetail } from '../api';
import Chart from '../Chart';
import { compactOption, line } from '../chartHelpers';
import { formatDuration, formatKm, formatPace, formatType } from '../format';
import { decodePolyline } from '../polyline';
import { defaultTileStyle, tileStyleUrl } from '../tileStyles';
import { useConfig } from '../useConfig';

const LINE_COLOR = '#e66a5f';

function ClusterMap({ polyline }: { polyline: string }) {
  const { stadiaApiKey } = useConfig();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map>();

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const coords = decodePolyline(polyline);
    if (coords.length < 2) return;
    let bounds = new maplibregl.LngLatBounds(coords[0], coords[0]);
    for (const c of coords) bounds = bounds.extend(c);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: tileStyleUrl(defaultTileStyle(stadiaApiKey), stadiaApiKey),
      bounds,
      fitBoundsOptions: { padding: 32 },
    });
    mapRef.current = map;
    map.on('style.load', () => {
      if (!map.getSource('route')) {
        map.addSource('route', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
        });
      }
      if (!map.getLayer('route-line')) {
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': LINE_COLOR, 'line-width': 3, 'line-opacity': 0.85 },
        });
      }
    });
    return () => {
      map.remove();
      mapRef.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polyline]);

  return <div ref={containerRef} style={{ width: '100%', height: 340, borderRadius: 6, overflow: 'hidden' }} />;
}

export default function RouteDetail() {
  const { id } = useParams<{ id: string }>();
  const clusterId = Number(id);
  const [compareIds, setCompareIds] = useState<string[]>([]);

  const { data, isPending, error } = useQuery({
    queryKey: ['route-cluster', clusterId],
    queryFn: () => fetchRouteClusterDetail(clusterId),
    enabled: Number.isInteger(clusterId) && clusterId > 0,
  });

  const { paceOption, efOption, hasEf } = useMemo(() => {
    const efforts = data?.efforts ?? [];
    const dates = efforts.map((e) => e.date);
    const paceValues = efforts.map((e) =>
      e.avgSpeedMps != null && e.avgSpeedMps > 0 ? Math.round(1000 / e.avgSpeedMps) : null,
    );
    // EF = metres per minute per heartbeat — same framing as the Efficiency page.
    const efValues = efforts.map((e) =>
      e.avgSpeedMps != null && e.avgHr != null && e.avgHr > 0
        ? Number(((e.avgSpeedMps * 60) / e.avgHr).toFixed(3))
        : null,
    );
    const paceOption: echarts.EChartsOption = {
      ...compactOption('Pace per effort (faster is higher)', dates),
      yAxis: {
        type: 'value',
        inverse: true,
        scale: true,
        axisLabel: { formatter: (v: number) => formatDuration(v) },
        splitLine: { lineStyle: { color: '#2a3038' } },
      },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: unknown) => (v == null ? '—' : `${formatDuration(v as number)} /km`),
      },
      series: [line('Pace', paceValues, '#5fa8e6', { showSymbol: true, symbolSize: 5 })],
    };
    const efOption: echarts.EChartsOption = {
      ...compactOption('Efficiency factor per effort (higher is fitter)', dates),
      yAxis: { type: 'value', scale: true, splitLine: { lineStyle: { color: '#2a3038' } } },
      tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (v == null ? '—' : String(v)) },
      series: [line('EF', efValues, '#5fce6e', { showSymbol: true, symbolSize: 5 })],
    };
    return { paceOption, efOption, hasEf: efValues.some((v) => v != null) };
  }, [data]);

  const toggleCompare = (activityId: string) => {
    setCompareIds((prev) =>
      prev.includes(activityId) ? prev.filter((x) => x !== activityId) : [...prev.slice(-1), activityId],
    );
  };

  if (isPending) return <p className="status">Loading…</p>;
  if (error) return <p className="status">Failed to load: {(error as Error).message}</p>;
  if (!data) return <p className="status">Route not found.</p>;

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>{data.name ?? `Route ${data.id}`}</h2>
        <span className="status">
          {formatType(data.type)} · {data.distanceM != null ? formatKm(data.distanceM, 1) : '—'} ·{' '}
          {data.efforts.length} efforts
        </span>
        <Link to="/routes" className="status">
          ← all routes
        </Link>
      </div>

      {data.polyline && <ClusterMap polyline={data.polyline} />}

      <div className="chart-grid" style={{ marginTop: '1rem' }}>
        <Chart option={paceOption} height={280} />
        {hasEf && <Chart option={efOption} height={280} />}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', margin: '1rem 0 0.4rem' }}>
        <h3 style={{ margin: 0 }}>Efforts</h3>
        <span className="status">tick two to compare</span>
        {compareIds.length === 2 && (
          <Link to={`/compare?a=${compareIds[0]}&b=${compareIds[1]}`}>Compare selected →</Link>
        )}
      </div>
      <table>
        <thead>
          <tr>
            <th />
            <th style={{ textAlign: 'left' }}>Date</th>
            <th style={{ textAlign: 'left' }}>Activity</th>
            <th style={{ textAlign: 'right' }}>Distance</th>
            <th style={{ textAlign: 'right' }}>Duration</th>
            <th style={{ textAlign: 'right' }}>Pace</th>
            <th style={{ textAlign: 'right' }}>Avg HR</th>
          </tr>
        </thead>
        <tbody>
          {data.efforts.map((e) => (
            <tr key={e.activityId}>
              <td>
                <input
                  type="checkbox"
                  checked={compareIds.includes(e.activityId)}
                  onChange={() => toggleCompare(e.activityId)}
                />
              </td>
              <td>{e.date}</td>
              <td>
                <Link to={`/activities/${e.activityId}`}>{e.name ?? e.activityId}</Link>
              </td>
              <td style={{ textAlign: 'right' }}>{e.distanceM != null ? formatKm(e.distanceM, 1) : '—'}</td>
              <td style={{ textAlign: 'right' }}>{formatDuration(e.durationS)}</td>
              <td style={{ textAlign: 'right' }}>{formatPace(e.avgSpeedMps)}</td>
              <td style={{ textAlign: 'right' }}>{e.avgHr != null ? `${Math.round(e.avgHr)} bpm` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
