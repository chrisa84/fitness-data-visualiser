import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { ActivitySample } from '@fitness/shared';

type MetricKey = 'pace' | 'hr' | 'balance' | 'gct' | 'cadence' | 'elevation';

const METRICS: { key: MetricKey; label: string }[] = [
  { key: 'pace', label: 'Pace' },
  { key: 'hr', label: 'Heart rate' },
  { key: 'elevation', label: 'Elevation' },
  { key: 'balance', label: 'L/R balance' },
  { key: 'gct', label: 'Ground contact' },
  { key: 'cadence', label: 'Cadence' },
];

function metricValue(s: ActivitySample, key: MetricKey): number | null {
  switch (key) {
    case 'pace':      return s.speedMps != null && s.speedMps >= 0.5 ? 1000 / (s.speedMps * 60) : null;
    case 'hr':        return s.heartRate;
    case 'elevation': return s.altitudeM;
    case 'balance':   return s.groundContactBalanceLeft != null ? Math.abs(s.groundContactBalanceLeft - 50) : null;
    case 'gct':       return s.groundContactMs;
    case 'cadence':   return s.cadence;
  }
}

function lerpColour(lo: [number, number, number], hi: [number, number, number], t: number): string {
  const r = Math.round(lo[0] + (hi[0] - lo[0]) * t);
  const g = Math.round(lo[1] + (hi[1] - lo[1]) * t);
  const b = Math.round(lo[2] + (hi[2] - lo[2]) * t);
  return `rgb(${r},${g},${b})`;
}

const BLUE: [number, number, number] = [95, 168, 230];
const RED: [number, number, number] = [230, 106, 95];
const GREEN: [number, number, number] = [95, 206, 110];

function segmentColour(v: number, min: number, max: number, key: MetricKey): string {
  if (max === min) return lerpColour(BLUE, RED, 0.5);
  const t = (v - min) / (max - min);
  // Higher cadence = better (green); higher elevation = blue (neutral info, not good/bad)
  if (key === 'cadence')   return lerpColour(RED, GREEN, t);
  if (key === 'elevation') return lerpColour(BLUE, RED, t);
  return lerpColour(GREEN, RED, t);
}

function formatTooltip(v: number, key: MetricKey): string {
  switch (key) {
    case 'pace': {
      const mins = Math.floor(v);
      const secs = Math.round((v - mins) * 60);
      return `${mins}:${String(secs).padStart(2, '0')} /km`;
    }
    case 'hr':        return `${Math.round(v)} bpm`;
    case 'elevation': return `${Math.round(v)} m`;
    case 'balance': return `${v.toFixed(1)}° from 50/50`;
    case 'gct':     return `${Math.round(v)} ms`;
    case 'cadence': return `${Math.round(v)} spm`;
  }
}

function buildGeoJSON(
  gpsPoints: ActivitySample[],
  metric: MetricKey,
): GeoJSON.FeatureCollection {
  const values = gpsPoints
    .map(s => metricValue(s, metric))
    .filter((v): v is number => v != null);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;

  const features: GeoJSON.Feature[] = [];
  for (let i = 0; i < gpsPoints.length - 1; i++) {
    const a = gpsPoints[i]!;
    const b = gpsPoints[i + 1]!;
    const v = metricValue(a, metric);
    const color = v != null ? segmentColour(v, min, max, metric) : '#888888';
    const tooltipText = v != null ? formatTooltip(v, metric) : null;
    features.push({
      type: 'Feature',
      properties: { color, tooltipText },
      geometry: {
        type: 'LineString',
        coordinates: [[a.lon!, a.lat!], [b.lon!, b.lat!]],
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

function addRouteLayers(map: maplibregl.Map) {
  if (!map.getSource('route')) {
    map.addSource('route', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer('route-halo')) {
    map.addLayer({
      id: 'route-halo',
      type: 'line',
      source: 'route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.45 },
    });
  }
  if (!map.getLayer('route-line')) {
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 5,
        'line-opacity': 0.9,
      },
    });
  }
}

interface Props {
  samples: ActivitySample[];
}

export default function RouteMap({ samples }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<maplibregl.Map>();
  const popupRef     = useRef<maplibregl.Popup>();
  const [metric, setMetric] = useState<MetricKey>('pace');

  // Keep refs so style.load handler always has the latest values without re-registering.
  const metricRef    = useRef(metric);
  const gpsRef       = useRef<ActivitySample[]>([]);
  metricRef.current  = metric;

  const gpsPoints = samples.filter(s => s.lat != null && s.lon != null);
  gpsRef.current  = gpsPoints;

  const availableMetrics = METRICS.filter(m =>
    gpsPoints.some(s => metricValue(s, m.key) != null),
  );

  // Init map once GPS points arrive (effect re-runs if they were empty on mount).
  useEffect(() => {
    if (!containerRef.current || gpsPoints.length === 0 || mapRef.current) return;

    const first = gpsPoints[0]!;
    const bounds = gpsPoints.reduce(
      (b, s) => b.extend([s.lon!, s.lat!] as [number, number]),
      new maplibregl.LngLatBounds([first.lon!, first.lat!], [first.lon!, first.lat!]),
    );

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      bounds,
      fitBoundsOptions: { padding: 24 },
    });
    mapRef.current = map;

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
    popupRef.current = popup;

    map.on('style.load', () => {
      addRouteLayers(map);
      (map.getSource('route') as maplibregl.GeoJSONSource).setData(
        buildGeoJSON(gpsRef.current, metricRef.current),
      );
    });

    map.on('mousemove', 'route-line', e => {
      map.getCanvas().style.cursor = 'pointer';
      const text = e.features?.[0]?.properties?.tooltipText as string | null;
      if (text) popup.setLngLat(e.lngLat).setHTML(text).addTo(map);
    });

    map.on('mouseleave', 'route-line', () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    });

    return () => {
      map.remove();
      mapRef.current = undefined;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsPoints.length]);

  // Rebuild route GeoJSON when metric changes (after initial style.load has fired).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || gpsPoints.length < 2) return;
    const source = map.getSource('route') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData(buildGeoJSON(gpsPoints, metric));
  }, [metric, gpsPoints.length]);

  if (gpsPoints.length === 0) return null;

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
        <h3 style={{ margin: 0 }}>Route</h3>
        <select
          value={metric}
          onChange={e => setMetric(e.target.value as MetricKey)}
          style={{
            background: '#1e2329',
            color: '#e6e8eb',
            border: '1px solid #2a3038',
            borderRadius: 4,
            padding: '2px 6px',
            fontSize: 13,
          }}
        >
          {availableMetrics.map(m => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>
      </div>
      <div
        ref={containerRef}
        style={{ width: '100%', height: 400, borderRadius: 6, overflow: 'hidden' }}
      />
    </section>
  );
}
