import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchActivities } from '../api';

interface Waypoint {
  latlng: L.LatLng;
  marker: L.Marker;
}

interface Segment {
  from: number;
  to: number;
  line: L.Polyline;
  distanceM: number;
}

const OSRM = 'https://router.project-osrm.org/route/v1/foot';

async function routeSegment(a: L.LatLng, b: L.LatLng): Promise<{ coords: L.LatLng[]; distanceM: number } | null> {
  try {
    const url = `${OSRM}/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const route = json.routes?.[0];
    if (!route) return null;
    const coords = (route.geometry.coordinates as [number, number][]).map(([lng, lat]) => L.latLng(lat, lng));
    return { coords, distanceM: route.distance };
  } catch {
    return null;
  }
}

function haversineM(a: L.LatLng, b: L.LatLng): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')} /km`;
}

export default function Planner() {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const waypointsRef = useRef<Waypoint[]>([]);
  const segmentsRef = useRef<Segment[]>([]);
  const [totalM, setTotalM] = useState(0);
  const [snap, setSnap] = useState(true);
  const [routing, setRouting] = useState(false);
  const [paceSec, setPaceSec] = useState(360); // 6:00 /km default

  const { data: activityData } = useQuery({
    queryKey: ['activities-pace'],
    queryFn: () => fetchActivities({ type: 'group:running', limit: 50, sort: 'start_time', order: 'desc' }),
  });

  // Derive average pace from recent running activities
  useEffect(() => {
    if (!activityData) return;
    const runs = activityData.items.filter((a) => a.distanceM && a.distanceM > 1000 && a.avgSpeedMps);
    if (runs.length === 0) return;
    const avgMps = runs.reduce((sum, a) => sum + (a.avgSpeedMps ?? 0), 0) / runs.length;
    if (avgMps > 0) setPaceSec(Math.round(1000 / avgMps));
  }, [activityData]);

  const recalcTotal = useCallback(() => {
    const total = segmentsRef.current.reduce((sum, s) => sum + s.distanceM, 0);
    setTotalM(total);
  }, []);

  const removeSegment = useCallback((idx: number) => {
    const seg = segmentsRef.current[idx];
    if (seg) seg.line.remove();
    segmentsRef.current.splice(idx, 1);
  }, []);

  const buildSegment = useCallback(
    async (fromIdx: number, toIdx: number) => {
      const map = mapRef.current;
      if (!map) return;
      const a = waypointsRef.current[fromIdx]?.latlng;
      const b = waypointsRef.current[toIdx]?.latlng;
      if (!a || !b) return;

      // Remove existing segment between these two if it exists
      const existing = segmentsRef.current.findIndex((s) => s.from === fromIdx && s.to === toIdx);
      if (existing !== -1) removeSegment(existing);

      let coords: L.LatLng[];
      let distanceM: number;

      if (snap) {
        setRouting(true);
        const result = await routeSegment(a, b);
        setRouting(false);
        if (result) {
          coords = result.coords;
          distanceM = result.distanceM;
        } else {
          coords = [a, b];
          distanceM = haversineM(a, b);
        }
      } else {
        coords = [a, b];
        distanceM = haversineM(a, b);
      }

      const line = L.polyline(coords, { color: '#5fa8e0', weight: 4, opacity: 0.85 }).addTo(map);
      segmentsRef.current.push({ from: fromIdx, to: toIdx, line, distanceM });
      recalcTotal();
    },
    [snap, removeSegment, recalcTotal],
  );

  const undoLast = useCallback(() => {
    const waypoints = waypointsRef.current;
    if (waypoints.length === 0) return;
    const last = waypoints[waypoints.length - 1];
    last?.marker.remove();
    waypoints.pop();

    // Remove any segment ending at the removed waypoint
    const toRemove = segmentsRef.current
      .map((s, i) => (s.from === waypoints.length || s.to === waypoints.length ? i : -1))
      .filter((i) => i !== -1)
      .reverse();
    for (const i of toRemove) removeSegment(i);
    recalcTotal();
  }, [removeSegment, recalcTotal]);

  const clearAll = useCallback(() => {
    for (const w of waypointsRef.current) w.marker.remove();
    for (const s of segmentsRef.current) s.line.remove();
    waypointsRef.current = [];
    segmentsRef.current = [];
    setTotalM(0);
  }, []);

  // Rebuild all segments when snap mode toggles
  useEffect(() => {
    if (waypointsRef.current.length < 2) return;
    const rebuild = async () => {
      for (const s of segmentsRef.current) s.line.remove();
      segmentsRef.current = [];
      for (let i = 0; i < waypointsRef.current.length - 1; i++) {
        await buildSegment(i, i + 1);
      }
    };
    rebuild();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, { zoomControl: true }).setView([51.505, -0.09], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;

    // Try to centre on user location
    navigator.geolocation?.getCurrentPosition(
      (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 14),
      () => {},
    );

    const markerIcon = L.divIcon({
      className: '',
      html: '<div style="width:12px;height:12px;border-radius:50%;background:#5fa8e0;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.5)"></div>',
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });

    map.on('click', async (e) => {
      const waypoints = waypointsRef.current;
      const marker = L.marker(e.latlng, { icon: markerIcon, draggable: true }).addTo(map);
      const idx = waypoints.length;
      waypoints.push({ latlng: e.latlng, marker });

      marker.on('dragend', async () => {
        waypoints[idx]!.latlng = marker.getLatLng();
        // Rebuild segments touching this waypoint
        const affected = segmentsRef.current
          .map((s, i) => (s.from === idx || s.to === idx ? i : -1))
          .filter((i) => i !== -1)
          .reverse();
        for (const i of affected) removeSegment(i);
        if (idx > 0) await buildSegment(idx - 1, idx);
        if (idx < waypoints.length - 1) await buildSegment(idx, idx + 1);
      });

      if (idx > 0) await buildSegment(idx - 1, idx);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const estimatedSeconds = paceSec > 0 && totalM > 0 ? (totalM / 1000) * paceSec : 0;

  const handlePaceInput = (val: string) => {
    const match = val.match(/^(\d+):(\d{0,2})$/);
    if (match) {
      const m = parseInt(match[1]!, 10);
      const s = parseInt(match[2] || '0', 10);
      if (!isNaN(m) && !isNaN(s) && s < 60) setPaceSec(m * 60 + s);
    }
  };

  const paceDisplay = `${Math.floor(paceSec / 60)}:${String(paceSec % 60).padStart(2, '0')}`;

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div className="controls" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
          Snap to paths
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Pace (min/km)
          <input
            type="text"
            value={paceDisplay}
            onChange={(e) => handlePaceInput(e.target.value)}
            style={{ width: '4rem', textAlign: 'center' }}
          />
        </label>
        <button onClick={undoLast}>Undo</button>
        <button onClick={clearAll}>Clear</button>
        {routing && <span style={{ color: '#8a93a0', fontSize: '0.85rem' }}>Routing…</span>}
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.9rem' }}>
        <span><strong style={{ color: '#e6e8eb' }}>{formatDistance(totalM)}</strong></span>
        {estimatedSeconds > 0 && (
          <>
            <span><strong style={{ color: '#e6e8eb' }}>{formatDuration(estimatedSeconds)}</strong></span>
            <span style={{ color: '#8a93a0' }}>{formatPace(paceSec)}</span>
          </>
        )}
      </div>

      <div ref={containerRef} style={{ flex: 1, minHeight: '560px', borderRadius: '6px', overflow: 'hidden' }} />
    </div>
  );
}
