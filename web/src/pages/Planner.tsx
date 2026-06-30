import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type * as echarts from 'echarts';
import type { SavedRoute } from '@fitness/shared';
import { fetchActivities, fetchRoutes, createSavedRoute, deleteSavedRoute } from '../api';
import Chart from '../Chart';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Waypoint { latlng: L.LatLng; marker: L.Marker }
interface Segment  { from: number; to: number; line: L.Polyline; distanceM: number; coords: L.LatLng[] }
interface SearchResult { placeId: number; displayName: string; lat: number; lon: number }
interface ElevPoint { distM: number; elevM: number }

// ---------------------------------------------------------------------------
// External APIs (no keys required)
// ---------------------------------------------------------------------------

const OSRM       = 'https://router.project-osrm.org/route/v1/foot';
const NOMINATIM  = 'https://nominatim.openstreetmap.org/search';
const TOPO       = 'https://api.opentopodata.org/v1/srtm90m';

async function osrmRoute(a: L.LatLng, b: L.LatLng): Promise<{ coords: L.LatLng[]; distanceM: number } | null> {
  try {
    const res = await fetch(`${OSRM}/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`);
    if (!res.ok) return null;
    const json = await res.json();
    const route = json.routes?.[0];
    if (!route) return null;
    const coords = (route.geometry.coordinates as [number, number][]).map(([lng, lat]) => L.latLng(lat, lng));
    return { coords, distanceM: route.distance };
  } catch { return null; }
}

async function nominatimSearch(q: string): Promise<SearchResult[]> {
  try {
    const res = await fetch(`${NOMINATIM}?q=${encodeURIComponent(q)}&format=json&limit=5`, {
      headers: { 'User-Agent': 'FitnessDataVisualiser/1.0' },
    });
    const json = await res.json();
    return json.map((r: Record<string, string>) => ({
      placeId: Number(r['place_id']),
      displayName: r['display_name'] ?? '',
      lat: parseFloat(r['lat'] ?? '0'),
      lon: parseFloat(r['lon'] ?? '0'),
    }));
  } catch { return []; }
}

async function fetchElevations(coords: L.LatLng[]): Promise<number[]> {
  const locs = coords.map(c => `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`).join('|');
  try {
    const res = await fetch(`${TOPO}?locations=${locs}`);
    const json = await res.json();
    if (json.status !== 'OK') return [];
    return (json.results as { elevation: number }[]).map(r => r.elevation ?? 0);
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function haversineM(a: L.LatLng, b: L.LatLng): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function sampleEvenly<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = (arr.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => arr[Math.round(i * step)]!);
}

function fmtDist(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.round(s % 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(ss).padStart(2, '0')}s`;
}

function fmtPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')} /km`;
}

// ---------------------------------------------------------------------------
// Marker icon (module-level so L is ready when first used)
// ---------------------------------------------------------------------------

const waypointIcon = L.divIcon({
  className: '',
  html: '<div style="width:12px;height:12px;border-radius:50%;background:#5fa8e0;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.5)"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

function kmIcon(label: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="background:#1e2329;color:#e6e8eb;border:1px solid #5fa8e0;border-radius:3px;padding:1px 5px;font-size:11px;font-weight:600;white-space:nowrap">${label}</div>`,
    iconAnchor: [0, 8],
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Planner() {
  const containerRef   = useRef<HTMLDivElement>(null);
  const mapRef         = useRef<L.Map | null>(null);
  const waypointsRef   = useRef<Waypoint[]>([]);
  const segmentsRef    = useRef<Segment[]>([]);
  const redoStackRef   = useRef<L.LatLng[]>([]);
  const kmMarkersRef   = useRef<L.Marker[]>([]);
  const snapRef        = useRef(true);
  const buildSegRef    = useRef<(f: number, t: number) => Promise<void>>(async () => {});
  const elevTimerRef   = useRef<ReturnType<typeof setTimeout>>();
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const [totalM,       setTotalM]       = useState(0);
  const [snap,         setSnap]         = useState(true);
  const [routing,      setRouting]      = useState(false);
  const [paceSec,      setPaceSec]      = useState(360);
  const [segVersion,   setSegVersion]   = useState(0);
  const [elevation,    setElevation]    = useState<ElevPoint[]>([]);
  const [elevGain,     setElevGain]     = useState(0);
  const [elevLoss,     setElevLoss]     = useState(0);
  const [fetchingElev, setFetchingElev] = useState(false);
  const [searchQuery,  setSearchQuery]  = useState('');
  const [searchResults,setSearchResults]= useState<SearchResult[]>([]);
  const [searchOpen,   setSearchOpen]   = useState(false);
  const [saveName,     setSaveName]     = useState('');
  const [saveOpen,     setSaveOpen]     = useState(false);

  // Keep snapRef in sync with snap state so closures always read current value
  useEffect(() => { snapRef.current = snap; }, [snap]);

  // ---------------------------------------------------------------------------
  // Pace from recent runs
  // ---------------------------------------------------------------------------

  const { data: activityData } = useQuery({
    queryKey: ['activities-pace'],
    queryFn: () => fetchActivities({ type: 'group:running', limit: 50, sort: 'start_time', order: 'desc' }),
  });

  useEffect(() => {
    if (!activityData) return;
    const runs = activityData.items.filter(a => a.distanceM && a.distanceM > 1000 && a.avgSpeedMps);
    if (!runs.length) return;
    const avgMps = runs.reduce((s, a) => s + (a.avgSpeedMps ?? 0), 0) / runs.length;
    if (avgMps > 0) setPaceSec(Math.round(1000 / avgMps));
  }, [activityData]);

  // ---------------------------------------------------------------------------
  // km markers
  // ---------------------------------------------------------------------------

  const drawKmMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of kmMarkersRef.current) m.remove();
    kmMarkersRef.current = [];

    const segs = segmentsRef.current;
    if (!segs.length) return;

    // Build cumulative distance array across all segment coords
    const pts: { latlng: L.LatLng; cumM: number }[] = [];
    let cumDist = 0;
    for (const seg of segs) {
      for (let i = 0; i < seg.coords.length; i++) {
        if (i === 0 && pts.length > 0) continue; // skip duplicate junction
        if (pts.length > 0) cumDist += haversineM(pts[pts.length - 1]!.latlng, seg.coords[i]!);
        pts.push({ latlng: seg.coords[i]!, cumM: cumDist });
      }
    }

    const maxKm = Math.floor(cumDist / 1000);
    for (let km = 1; km <= maxKm; km++) {
      const target = km * 1000;
      const idx = pts.findIndex(p => p.cumM >= target);
      if (idx <= 0) continue;
      const a = pts[idx - 1]!;
      const b = pts[idx]!;
      const t = (target - a.cumM) / (b.cumM - a.cumM);
      const lat = a.latlng.lat + (b.latlng.lat - a.latlng.lat) * t;
      const lng = a.latlng.lng + (b.latlng.lng - a.latlng.lng) * t;
      kmMarkersRef.current.push(L.marker([lat, lng], { icon: kmIcon(`${km} km`), interactive: false }).addTo(map));
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Segment management
  // ---------------------------------------------------------------------------

  const recalcTotal = useCallback(() => {
    const total = segmentsRef.current.reduce((s, seg) => s + seg.distanceM, 0);
    setTotalM(total);
    drawKmMarkers();
    setSegVersion(v => v + 1);
  }, [drawKmMarkers]);

  const removeSegment = useCallback((idx: number) => {
    segmentsRef.current[idx]?.line.remove();
    segmentsRef.current.splice(idx, 1);
  }, []);

  const buildSegment = useCallback(async (fromIdx: number, toIdx: number) => {
    const map = mapRef.current;
    if (!map) return;
    const a = waypointsRef.current[fromIdx]?.latlng;
    const b = waypointsRef.current[toIdx]?.latlng;
    if (!a || !b) return;

    const existing = segmentsRef.current.findIndex(s => s.from === fromIdx && s.to === toIdx);
    if (existing !== -1) removeSegment(existing);

    let coords: L.LatLng[];
    let distanceM: number;

    if (snapRef.current) {
      setRouting(true);
      const result = await osrmRoute(a, b);
      setRouting(false);
      if (result) { coords = result.coords; distanceM = result.distanceM; }
      else { coords = [a, b]; distanceM = haversineM(a, b); }
    } else {
      coords = [a, b];
      distanceM = haversineM(a, b);
    }

    const line = L.polyline(coords, { color: '#5fa8e0', weight: 4, opacity: 0.85 }).addTo(map);
    segmentsRef.current.push({ from: fromIdx, to: toIdx, line, distanceM, coords });
    recalcTotal();
  }, [removeSegment, recalcTotal]);

  // Keep buildSegRef current so map click handler closure always calls the latest version
  useEffect(() => { buildSegRef.current = buildSegment; }, [buildSegment]);

  // ---------------------------------------------------------------------------
  // Waypoint management
  // ---------------------------------------------------------------------------

  const addWaypointAt = useCallback(async (latlng: L.LatLng, clearRedo = true) => {
    const map = mapRef.current;
    if (!map) return;
    if (clearRedo) redoStackRef.current = [];

    const marker = L.marker(latlng, { icon: waypointIcon, draggable: true }).addTo(map);
    const idx = waypointsRef.current.length;
    waypointsRef.current.push({ latlng, marker });

    marker.on('dragend', async () => {
      waypointsRef.current[idx]!.latlng = marker.getLatLng();
      const affected = segmentsRef.current
        .map((s, i) => (s.from === idx || s.to === idx ? i : -1))
        .filter(i => i !== -1).reverse();
      for (const i of affected) removeSegment(i);
      if (idx > 0) await buildSegRef.current(idx - 1, idx);
      if (idx < waypointsRef.current.length - 1) await buildSegRef.current(idx, idx + 1);
    });

    if (idx > 0) await buildSegRef.current(idx - 1, idx);
  }, [removeSegment]);

  const undoLast = useCallback(() => {
    const wps = waypointsRef.current;
    if (!wps.length) return;
    const removed = wps[wps.length - 1]!;
    redoStackRef.current.push(removed.latlng);
    removed.marker.remove();
    wps.pop();
    const lastIdx = wps.length;
    const toRemove = segmentsRef.current
      .map((s, i) => (s.from === lastIdx || s.to === lastIdx ? i : -1))
      .filter(i => i !== -1).reverse();
    for (const i of toRemove) removeSegment(i);
    recalcTotal();
  }, [removeSegment, recalcTotal]);

  const redoPoint = useCallback(async () => {
    const latlng = redoStackRef.current.pop();
    if (!latlng) return;
    await addWaypointAt(latlng, false);
  }, [addWaypointAt]);

  const reverseRoute = useCallback(async () => {
    if (waypointsRef.current.length < 2) return;
    for (const s of segmentsRef.current) s.line.remove();
    segmentsRef.current = [];
    waypointsRef.current.reverse();
    for (let i = 0; i < waypointsRef.current.length - 1; i++) {
      await buildSegRef.current(i, i + 1);
    }
  }, []);

  const clearAll = useCallback(() => {
    for (const w of waypointsRef.current) w.marker.remove();
    for (const s of segmentsRef.current) s.line.remove();
    for (const m of kmMarkersRef.current) m.remove();
    waypointsRef.current = [];
    segmentsRef.current = [];
    kmMarkersRef.current = [];
    redoStackRef.current = [];
    setTotalM(0);
    setElevation([]);
    setElevGain(0);
    setElevLoss(0);
    setSegVersion(v => v + 1);
  }, []);

  // ---------------------------------------------------------------------------
  // Saved routes
  // ---------------------------------------------------------------------------

  const queryClient = useQueryClient();
  const { data: savedRoutes = [] } = useQuery({ queryKey: ['saved-routes'], queryFn: fetchRoutes });

  const saveMutation = useMutation({
    mutationFn: createSavedRoute,
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['saved-routes'] }); setSaveOpen(false); setSaveName(''); },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSavedRoute,
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['saved-routes'] }); },
  });

  const saveRoute = useCallback(() => {
    if (!saveName.trim() || totalM === 0) return;
    saveMutation.mutate({
      name: saveName.trim(),
      waypoints: waypointsRef.current.map(w => ({ lat: w.latlng.lat, lng: w.latlng.lng })),
      snap,
      totalDistanceM: totalM,
    });
  }, [saveName, totalM, snap, saveMutation]);

  const loadRoute = useCallback(async (route: SavedRoute) => {
    clearAll();
    snapRef.current = route.snap;
    setSnap(route.snap);
    for (const wp of route.waypoints) {
      await addWaypointAt(L.latLng(wp.lat, wp.lng), false);
    }
  }, [clearAll, addWaypointAt]);

  // ---------------------------------------------------------------------------
  // Rebuild segments when snap toggles
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (waypointsRef.current.length < 2) return;
    const rebuild = async () => {
      for (const s of segmentsRef.current) s.line.remove();
      segmentsRef.current = [];
      for (let i = 0; i < waypointsRef.current.length - 1; i++) {
        await buildSegRef.current(i, i + 1);
      }
    };
    rebuild();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap]);

  // ---------------------------------------------------------------------------
  // Elevation profile (debounced, triggers on segVersion)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    clearTimeout(elevTimerRef.current);
    if (!segmentsRef.current.length) {
      setElevation([]); setElevGain(0); setElevLoss(0);
      return;
    }
    elevTimerRef.current = setTimeout(async () => {
      // Collect all route coords with cumulative distance
      const pts: { latlng: L.LatLng; cumM: number }[] = [];
      let cum = 0;
      for (const seg of segmentsRef.current) {
        for (let i = 0; i < seg.coords.length; i++) {
          if (i === 0 && pts.length > 0) continue;
          if (pts.length > 0) cum += haversineM(pts[pts.length - 1]!.latlng, seg.coords[i]!);
          pts.push({ latlng: seg.coords[i]!, cumM: cum });
        }
      }
      const sampled = sampleEvenly(pts, 100);
      setFetchingElev(true);
      const elevs = await fetchElevations(sampled.map(p => p.latlng));
      setFetchingElev(false);
      if (!elevs.length) return;
      const elevPts: ElevPoint[] = sampled.map((p, i) => ({ distM: p.cumM, elevM: elevs[i] ?? 0 }));
      setElevation(elevPts);
      let gain = 0, loss = 0;
      for (let i = 1; i < elevPts.length; i++) {
        const diff = elevPts[i]!.elevM - elevPts[i - 1]!.elevM;
        if (diff > 0) gain += diff; else loss += Math.abs(diff);
      }
      setElevGain(Math.round(gain));
      setElevLoss(Math.round(loss));
    }, 1200);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segVersion]);

  // ---------------------------------------------------------------------------
  // GPX export
  // ---------------------------------------------------------------------------

  const exportGpx = useCallback(() => {
    const segs = segmentsRef.current;
    if (!segs.length) return;
    const all: L.LatLng[] = [];
    for (const seg of segs) {
      for (let i = 0; i < seg.coords.length; i++) {
        if (i === 0 && all.length > 0) continue;
        all.push(seg.coords[i]!);
      }
    }
    const trkpts = all.map(c =>
      `      <trkpt lat="${c.lat.toFixed(6)}" lon="${c.lng.toFixed(6)}"></trkpt>`
    ).join('\n');
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Fitness Data Visualiser" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Planned Route</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
    a.download = 'route.gpx';
    a.click();
  }, []);

  // ---------------------------------------------------------------------------
  // Location search
  // ---------------------------------------------------------------------------

  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    clearTimeout(searchTimerRef.current);
    if (q.length < 3) { setSearchResults([]); setSearchOpen(false); return; }
    searchTimerRef.current = setTimeout(async () => {
      const results = await nominatimSearch(q);
      setSearchResults(results);
      setSearchOpen(results.length > 0);
    }, 400);
  }, []);

  const selectResult = useCallback((r: SearchResult) => {
    mapRef.current?.setView([r.lat, r.lon], 14);
    setSearchQuery(r.displayName.split(',')[0] ?? r.displayName);
    setSearchResults([]);
    setSearchOpen(false);
  }, []);

  const findMyLocation = useCallback(() => {
    navigator.geolocation?.getCurrentPosition(
      pos => mapRef.current?.setView([pos.coords.latitude, pos.coords.longitude], 15),
      () => {},
    );
  }, []);

  // ---------------------------------------------------------------------------
  // Map init (runs once)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView([51.505, -0.09], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    navigator.geolocation?.getCurrentPosition(
      pos => map.setView([pos.coords.latitude, pos.coords.longitude], 14),
      () => {},
    );
    map.on('click', async (e) => { await addWaypointAt(e.latlng); });
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Elevation chart option
  // ---------------------------------------------------------------------------

  const elevOption = useMemo((): echarts.EChartsOption => {
    const data = elevation.map(p => [+(p.distM / 1000).toFixed(3), +p.elevM.toFixed(1)]);
    return {
      backgroundColor: 'transparent',
      title: { text: 'Elevation profile', textStyle: { color: '#e6e8eb', fontSize: 13 }, left: 0, top: 4 },
      tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => `${v} m` },
      grid: { left: 52, right: 16, top: 36, bottom: 40 },
      xAxis: { type: 'value', name: 'km', nameLocation: 'end', axisLabel: { color: '#8a93a0' }, splitLine: { lineStyle: { color: '#2a3038' } } },
      yAxis: { type: 'value', name: 'm', scale: true, axisLabel: { color: '#8a93a0' }, splitLine: { lineStyle: { color: '#2a3038' } } },
      series: [{
        type: 'line',
        data,
        showSymbol: false,
        areaStyle: { color: 'rgba(95,206,110,0.15)' },
        lineStyle: { width: 1.5, color: '#5fce6e' },
        itemStyle: { color: '#5fce6e' },
      }],
    };
  }, [elevation]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const estimatedSeconds = paceSec > 0 && totalM > 0 ? (totalM / 1000) * paceSec : 0;
  const paceDisplay = `${Math.floor(paceSec / 60)}:${String(paceSec % 60).padStart(2, '0')}`;

  const handlePaceInput = (val: string) => {
    const m = val.match(/^(\d+):(\d{0,2})$/);
    if (m) {
      const mins = parseInt(m[1]!, 10);
      const secs = parseInt(m[2] || '0', 10);
      if (!isNaN(mins) && !isNaN(secs) && secs < 60) setPaceSec(mins * 60 + secs);
    }
  };

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

      {/* Search bar */}
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          placeholder="Search for a location…"
          value={searchQuery}
          onChange={e => handleSearch(e.target.value)}
          onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
          style={{ width: '100%', boxSizing: 'border-box', padding: '0.4rem 0.6rem', background: '#1e2329', color: '#e6e8eb', border: '1px solid #2a3038', borderRadius: 4, fontSize: '0.9rem' }}
        />
        {searchOpen && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000, background: '#1e2329', border: '1px solid #2a3038', borderRadius: 4, marginTop: 2 }}>
            {searchResults.map(r => (
              <div
                key={r.placeId}
                onClick={() => selectResult(r)}
                style={{ padding: '0.4rem 0.6rem', cursor: 'pointer', fontSize: '0.85rem', color: '#e6e8eb', borderBottom: '1px solid #2a3038' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#2a3038')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {r.displayName}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="controls" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} />
          Snap to paths
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Pace
          <input
            type="text"
            value={paceDisplay}
            onChange={e => handlePaceInput(e.target.value)}
            style={{ width: '4rem', textAlign: 'center' }}
          />
          <span style={{ color: '#8a93a0', fontSize: '0.8rem' }}>min/km</span>
        </label>
        <button onClick={findMyLocation} title="Find my location">📍 Locate</button>
        <button onClick={undoLast}>Undo</button>
        <button onClick={redoPoint}>Redo</button>
        <button onClick={reverseRoute}>Reverse</button>
        <button onClick={exportGpx} disabled={totalM === 0}>Export GPX</button>
        <button onClick={clearAll}>Clear</button>
        {routing && <span style={{ color: '#8a93a0', fontSize: '0.85rem' }}>Routing…</span>}
        {fetchingElev && <span style={{ color: '#8a93a0', fontSize: '0.85rem' }}>Elevation…</span>}
      </div>

      {/* Stats bar */}
      {totalM > 0 && (
        <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.9rem', flexWrap: 'wrap' }}>
          <span><strong style={{ color: '#e6e8eb' }}>{fmtDist(totalM)}</strong></span>
          {estimatedSeconds > 0 && <span><strong style={{ color: '#e6e8eb' }}>{fmtTime(estimatedSeconds)}</strong></span>}
          {estimatedSeconds > 0 && <span style={{ color: '#8a93a0' }}>{fmtPace(paceSec)}</span>}
          {elevGain > 0 && <span style={{ color: '#5fce6e' }}>↑ {elevGain} m</span>}
          {elevLoss > 0 && <span style={{ color: '#e66a5f' }}>↓ {elevLoss} m</span>}
        </div>
      )}

      {/* Map */}
      <div ref={containerRef} style={{ flex: 1, minHeight: '520px', borderRadius: '6px', overflow: 'hidden' }} />

      {/* Elevation profile */}
      {elevation.length > 1 && <Chart option={elevOption} height={200} />}

      {/* Saved routes */}
      <div style={{ borderTop: '1px solid #2a3038', paddingTop: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <strong style={{ color: '#e6e8eb', fontSize: '0.9rem' }}>Saved routes</strong>
          {!saveOpen && (
            <button onClick={() => setSaveOpen(true)} disabled={totalM === 0}>Save current</button>
          )}
          {saveOpen && (
            <>
              <input
                type="text"
                placeholder="Route name…"
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveRoute()}
                autoFocus
                style={{ padding: '0.3rem 0.5rem', background: '#1e2329', color: '#e6e8eb', border: '1px solid #2a3038', borderRadius: 4, fontSize: '0.85rem' }}
              />
              <button onClick={saveRoute} disabled={!saveName.trim() || saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => { setSaveOpen(false); setSaveName(''); }}>Cancel</button>
            </>
          )}
        </div>

        {savedRoutes.length === 0 && (
          <p style={{ color: '#8a93a0', fontSize: '0.85rem', margin: 0 }}>No saved routes yet.</p>
        )}

        {savedRoutes.map(r => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0', borderBottom: '1px solid #2a3038', fontSize: '0.85rem' }}>
            <span style={{ flex: 1, color: '#e6e8eb' }}>{r.name}</span>
            {r.totalDistanceM != null && (
              <span style={{ color: '#8a93a0' }}>{fmtDist(r.totalDistanceM)}</span>
            )}
            <span style={{ color: '#8a93a0' }}>{r.createdAt.slice(0, 10)}</span>
            <button onClick={() => void loadRoute(r)}>Load</button>
            <button
              onClick={() => deleteMutation.mutate(r.id)}
              disabled={deleteMutation.isPending}
              style={{ color: '#e66a5f' }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
