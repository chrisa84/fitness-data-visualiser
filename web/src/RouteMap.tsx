import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ActivitySample } from '@fitness/shared';

type MetricKey = 'pace' | 'hr' | 'balance' | 'gct' | 'cadence';

const METRICS: { key: MetricKey; label: string }[] = [
  { key: 'pace', label: 'Pace' },
  { key: 'hr', label: 'Heart rate' },
  { key: 'balance', label: 'L/R balance' },
  { key: 'gct', label: 'Ground contact' },
  { key: 'cadence', label: 'Cadence' },
];

function metricValue(s: ActivitySample, key: MetricKey): number | null {
  switch (key) {
    case 'pace':
      return s.speedMps != null && s.speedMps >= 0.5 ? 1000 / (s.speedMps * 60) : null;
    case 'hr':
      return s.heartRate;
    case 'balance':
      return s.groundContactBalanceLeft != null ? Math.abs(s.groundContactBalanceLeft - 50) : null;
    case 'gct':
      return s.groundContactMs;
    case 'cadence':
      return s.cadence;
  }
}

// Linear interpolation between two hex colours via RGB.
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
  // Pace and GCT: lower is better (green = fast/low, red = slow/high)
  // HR: blue (low) → red (high)
  // Balance: deviation from 50 — green = balanced, red = imbalanced
  // Cadence: green (high) → red (low), so invert
  if (key === 'cadence') return lerpColour(RED, GREEN, t);
  if (key === 'balance') return lerpColour(GREEN, RED, t);
  return lerpColour(GREEN, RED, t);
}

function formatTooltip(v: number, key: MetricKey): string {
  switch (key) {
    case 'pace': {
      const mins = Math.floor(v);
      const secs = Math.round((v - mins) * 60);
      return `${mins}:${String(secs).padStart(2, '0')} /km`;
    }
    case 'hr':
      return `${Math.round(v)} bpm`;
    case 'balance':
      return `${v.toFixed(1)}° from 50/50`;
    case 'gct':
      return `${Math.round(v)} ms`;
    case 'cadence':
      return `${Math.round(v)} spm`;
  }
}

interface Props {
  samples: ActivitySample[];
}

export default function RouteMap({ samples }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map>();
  const layerGroupRef = useRef<L.LayerGroup>();
  const [metric, setMetric] = useState<MetricKey>('pace');

  const gpsPoints = samples.filter((s) => s.lat != null && s.lon != null);

  // Determine which metrics have any data.
  const availableMetrics = METRICS.filter((m) =>
    gpsPoints.some((s) => metricValue(s, m.key) != null),
  );

  // Init map once GPS points are available. Runs again if gpsPoints arrive after mount.
  useEffect(() => {
    if (!containerRef.current || gpsPoints.length === 0 || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;
    const bounds = L.latLngBounds(gpsPoints.map((s) => [s.lat!, s.lon!] as L.LatLngTuple));
    map.fitBounds(bounds, { padding: [24, 24] });
    return () => {
      map.remove();
      mapRef.current = undefined;
      layerGroupRef.current = undefined;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsPoints.length]);

  // Redraw segments whenever metric or samples change.
  useEffect(() => {
    const group = layerGroupRef.current;
    if (!group || gpsPoints.length < 2) return;

    group.clearLayers();

    const values = gpsPoints.map((s) => metricValue(s, metric)).filter((v): v is number => v != null);
    const min = Math.min(...values);
    const max = Math.max(...values);

    for (let i = 0; i < gpsPoints.length - 1; i++) {
      const a = gpsPoints[i]!;
      const b = gpsPoints[i + 1]!;
      const v = metricValue(a, metric);
      const colour = v != null ? segmentColour(v, min, max, metric) : '#444';
      const seg = L.polyline(
        [
          [a.lat!, a.lon!],
          [b.lat!, b.lon!],
        ],
        { color: colour, weight: 4, opacity: 0.85 },
      );
      if (v != null) {
        seg.bindTooltip(formatTooltip(v, metric), { sticky: true });
      }
      seg.addTo(group);
    }
  }, [metric, gpsPoints.length]);

  if (gpsPoints.length === 0) return null;

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
        <h3 style={{ margin: 0 }}>Route</h3>
        <select
          value={metric}
          onChange={(e) => setMetric(e.target.value as MetricKey)}
          style={{ background: '#1e2329', color: '#e6e8eb', border: '1px solid #2a3038', borderRadius: 4, padding: '2px 6px', fontSize: 13 }}
        >
          {availableMetrics.map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>
      </div>
      <div ref={containerRef} style={{ width: '100%', height: 400, borderRadius: 6, overflow: 'hidden' }} />
    </section>
  );
}
