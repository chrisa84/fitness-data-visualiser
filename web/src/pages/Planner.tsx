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
type TileStyle = 'osm' | 'topo' | 'carto';

// ---------------------------------------------------------------------------
// Tile configs
// ---------------------------------------------------------------------------

const TILE_CONFIGS: Record<TileStyle, { url: string; attribution: string; maxZoom: number; label: string }> = {
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
    label: 'Standard',
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org">OpenStreetMap</a>, © <a href="https://opentopomap.org">OpenTopoMap</a>',
    maxZoom: 17,
    label: 'Topo',
  },
  carto: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '© <a href="https://www.openstreetmap.org">OpenStreetMap</a>, © <a href="https://carto.com">CARTO</a>',
    maxZoom: 19,
    label: 'Light',
  },
};

// ---------------------------------------------------------------------------
// External APIs (no keys required)
// ---------------------------------------------------------------------------

const OSRM      = 'https://router.project-osrm.org/route/v1/foot';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const TOPO_API  = 'https://api.opentopodata.org/v1/srtm90m';

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
    const res = await fetch(`${TOPO_API}?locations=${locs}`);
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
// Marker icons
// ---------------------------------------------------------------------------

function waypointDivIcon(index: number, total: number): L.DivIcon {
  const isStart = index === 0;
  const isEnd   = index === total - 1 && total > 1;
  const bg      = isStart ? '#22c55e' : isEnd ? '#ef4444' : '#5fa8e0';
  const label   = isStart ? 'S' : isEnd ? 'E' : String(index + 1);
  return L.divIcon({
    className: '',
    html: `<div style="width:26px;height:26px;border-radius:50%;background:${bg};border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;font-family:system-ui,sans-serif;letter-spacing:0">${label}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function kmIcon(label: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="background:#1e2329cc;color:#e6e8eb;border:1px solid #5fa8e0;border-radius:3px;padding:1px 5px;font-size:11px;font-weight:600;white-space:nowrap;backdrop-filter:blur(2px)">${label}</div>`,
    iconAnchor: [0, 8],
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Planner() {
  const containerRef   = useRef<HTMLDivElement>(null);
  const mapRef         = useRef<L.Map | null>(null);
  const tileLayerRef   = useRef<L.TileLayer | null>(null);
  const waypointsRef   = useRef<Waypoint[]>([]);
  const segmentsRef    = useRef<Segment[]>([]);
  const redoStackRef   = useRef<L.LatLng[]>([]);
  const kmMarkersRef   = useRef<L.Marker[]>([]);
  const snapRef        = useRef(true);
  const buildSegRef    = useRef<(f: number, t: number) => Promise<void>>(async () => {});
  const elevTimerRef   = useRef<ReturnType<typeof setTimeout>>();
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const [totalM,        setTotalM]        = useState(0);
  const [snap,          setSnap]          = useState(true);
  const [routing,       setRouting]       = useState(false);
  const [paceSec,       setPaceSec]       = useState(360);
  const [segVersion,    setSegVersion]    = useState(0);
  const [elevation,     setElevation]     = useState<ElevPoint[]>([]);
  const [elevGain,      setElevGain]      = useState(0);
  const [elevLoss,      setElevLoss]      = useState(0);
  const [fetchingElev,  setFetchingElev]  = useState(false);
  const [searchQuery,   setSearchQuery]   = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen,    setSearchOpen]    = useState(false);
  const [saveName,      setSaveName]      = useState('');
  const [saveOpen,      setSaveOpen]      = useState(false);
  const [tileStyle,     setTileStyle]     = useState<TileStyle>('osm');

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
  // Marker icon refresh
  // ---------------------------------------------------------------------------

  const updateMarkerIcons = useCallback(() => {
    const wps = waypointsRef.current;
    wps.forEach((wp, i) => wp.marker.setIcon(waypointDivIcon(i, wps.length)));
  }, []);

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

    const pts: { latlng: L.LatLng; cumM: number }[] = [];
    let cumDist = 0;
    for (const seg of segs) {
      for (let i = 0; i < seg.coords.length; i++) {
        if (i === 0 && pts.length > 0) continue;
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
      kmMarkersRef.current.push(
        L.marker([lat, lng], { icon: kmIcon(`${km} km`), interactive: false }).addTo(map)
      );
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
      else         { coords = [a, b];        distanceM = haversineM(a, b); }
    } else {
      coords = [a, b];
      distanceM = haversineM(a, b);
    }

    const line = L.polyline(coords, { color: '#5fa8e0', weight: 5, opacity: 0.9 }).addTo(map);
    segmentsRef.current.push({ from: fromIdx, to: toIdx, line, distanceM, coords });
    recalcTotal();
  }, [removeSegment, recalcTotal]);

  useEffect(() => { buildSegRef.current = buildSegment; }, [buildSegment]);

  // ---------------------------------------------------------------------------
  // Waypoint management
  // ---------------------------------------------------------------------------

  const addWaypointAt = useCallback(async (latlng: L.LatLng, clearRedo = true) => {
    const map = mapRef.current;
    if (!map) return;
    if (clearRedo) redoStackRef.current = [];

    const idx = waypointsRef.current.length;
    const marker = L.marker(latlng, {
      icon: waypointDivIcon(idx, idx + 1),
      draggable: true,
    }).addTo(map);
    waypointsRef.current.push({ latlng, marker });
    updateMarkerIcons();

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
  }, [removeSegment, updateMarkerIcons]);

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
    updateMarkerIcons();
    recalcTotal();
  }, [removeSegment, recalcTotal, updateMarkerIcons]);

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
    updateMarkerIcons();
    for (let i = 0; i < waypointsRef.current.length - 1; i++) {
      await buildSegRef.current(i, i + 1);
    }
  }, [updateMarkerIcons]);

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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['saved-routes'] });
      setSaveOpen(false);
      setSaveName('');
    },
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
  // Map init (once — no tile layer added here, tile effect handles it)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView([51.505, -0.09], 13);
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
  // Tile layer — swap when tileStyle changes (also handles initial add)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileLayerRef.current) { tileLayerRef.current.remove(); tileLayerRef.current = null; }
    const cfg = TILE_CONFIGS[tileStyle];
    tileLayerRef.current = L.tileLayer(cfg.url, { attribution: cfg.attribution, maxZoom: cfg.maxZoom }).addTo(map);
  }, [tileStyle]);

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
      xAxis: {
        type: 'value', name: 'km', nameLocation: 'end',
        axisLabel: { color: '#8a93a0' }, splitLine: { lineStyle: { color: '#2a3038' } },
      },
      yAxis: {
        type: 'value', name: 'm', scale: true,
        axisLabel: { color: '#8a93a0' }, splitLine: { lineStyle: { color: '#2a3038' } },
      },
      series: [{
        type: 'line',
        data,
        showSymbol: false,
        areaStyle: { color: 'rgba(95,206,110,0.18)' },
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

  const btnStyle = (active?: boolean): React.CSSProperties => ({
    padding: '0.35rem 0.65rem',
    fontSize: '0.82rem',
    borderRadius: 5,
    border: active ? '1px solid #5fa8e0' : '1px solid #2a3038',
    background: active ? '#1a3a52' : '#1e2329',
    color: active ? '#5fa8e0' : '#c0c7d0',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3rem',
    whiteSpace: 'nowrap' as const,
  });

  const statCard = (label: string, value: string, colour?: string): React.ReactNode => (
    <div style={{ background: '#1e2329', border: '1px solid #2a3038', borderRadius: 6, padding: '0.45rem 0.85rem', display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 80 }}>
      <span style={{ fontSize: '1rem', fontWeight: 700, color: colour ?? '#e6e8eb' }}>{value}</span>
      <span style={{ fontSize: '0.7rem', color: '#8a93a0', marginTop: 1 }}>{label}</span>
    </div>
  );

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>

      {/* Search bar */}
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.9rem', pointerEvents: 'none' }}>🔍</span>
          <input
            type="text"
            placeholder="Search for a location…"
            value={searchQuery}
            onChange={e => handleSearch(e.target.value)}
            onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
            style={{ width: '100%', boxSizing: 'border-box', padding: '0.45rem 0.6rem 0.45rem 2rem', background: '#1e2329', color: '#e6e8eb', border: '1px solid #2a3038', borderRadius: 6, fontSize: '0.9rem' }}
          />
        </div>
        {searchOpen && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000, background: '#1e2329', border: '1px solid #2a3038', borderRadius: 6, marginTop: 3, boxShadow: '0 4px 16px rgba(0,0,0,.4)' }}>
            {searchResults.map(r => (
              <div
                key={r.placeId}
                onClick={() => selectResult(r)}
                style={{ padding: '0.45rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem', color: '#e6e8eb', borderBottom: '1px solid #2a3038' }}
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>

        {/* Snap toggle */}
        <button
          onClick={() => setSnap(s => !s)}
          style={{ ...btnStyle(snap), fontWeight: snap ? 600 : 400 }}
          title="Toggle snap to paths"
        >
          {snap ? '🛤️' : '✏️'} {snap ? 'Snap on' : 'Freehand'}
        </button>

        {/* Pace */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: '#1e2329', border: '1px solid #2a3038', borderRadius: 5, padding: '0.2rem 0.55rem' }}>
          <span style={{ fontSize: '0.8rem', color: '#8a93a0' }}>⏱️</span>
          <input
            type="text"
            value={paceDisplay}
            onChange={e => handlePaceInput(e.target.value)}
            style={{ width: '3.6rem', textAlign: 'center', background: 'transparent', border: 'none', color: '#e6e8eb', fontSize: '0.85rem', outline: 'none' }}
          />
          <span style={{ color: '#8a93a0', fontSize: '0.75rem' }}>/km</span>
        </div>

        <div style={{ width: 1, height: 22, background: '#2a3038', margin: '0 0.1rem' }} />

        {/* Action buttons */}
        <button onClick={findMyLocation}  style={btnStyle()} title="Centre on my location">📍 Locate</button>
        <button onClick={undoLast}        style={btnStyle()} title="Undo last point">↩ Undo</button>
        <button onClick={redoPoint}       style={btnStyle()} title="Redo">↪ Redo</button>
        <button onClick={reverseRoute}    style={btnStyle()} title="Reverse route">⇅ Reverse</button>
        <button onClick={exportGpx}       style={btnStyle()} disabled={totalM === 0} title="Export GPX">⬇ GPX</button>
        <button onClick={clearAll}        style={{ ...btnStyle(), color: '#e66a5f' }} title="Clear all">✕ Clear</button>

        <div style={{ width: 1, height: 22, background: '#2a3038', margin: '0 0.1rem' }} />

        {/* Tile switcher */}
        {(['osm', 'topo', 'carto'] as TileStyle[]).map(t => (
          <button key={t} onClick={() => setTileStyle(t)} style={btnStyle(tileStyle === t)}>
            {TILE_CONFIGS[t].label}
          </button>
        ))}

        {/* Status */}
        {routing      && <span style={{ color: '#8a93a0', fontSize: '0.8rem', marginLeft: 4 }}>Routing…</span>}
        {fetchingElev && <span style={{ color: '#8a93a0', fontSize: '0.8rem', marginLeft: 4 }}>Elevation…</span>}
      </div>

      {/* Stats bar */}
      {totalM > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {statCard('Distance', fmtDist(totalM))}
          {estimatedSeconds > 0 && statCard('Est. time', fmtTime(estimatedSeconds))}
          {estimatedSeconds > 0 && statCard('Pace', fmtPace(paceSec), '#8a93a0')}
          {elevGain > 0         && statCard('Ascent', `↑ ${elevGain} m`, '#5fce6e')}
          {elevLoss > 0         && statCard('Descent', `↓ ${elevLoss} m`, '#e66a5f')}
        </div>
      )}

      {/* Map */}
      <div ref={containerRef} style={{ flex: 1, minHeight: '520px', borderRadius: 8, overflow: 'hidden', border: '1px solid #2a3038' }} />

      {/* Elevation profile */}
      {elevation.length > 1 && (
        <div style={{ border: '1px solid #2a3038', borderRadius: 8, padding: '0.5rem', background: '#161a1f' }}>
          <Chart option={elevOption} height={180} />
        </div>
      )}

      {/* Saved routes */}
      <div style={{ border: '1px solid #2a3038', borderRadius: 8, padding: '0.75rem', background: '#161a1f' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.6rem' }}>
          <strong style={{ color: '#e6e8eb', fontSize: '0.9rem' }}>💾 Saved routes</strong>
          {!saveOpen && (
            <button onClick={() => setSaveOpen(true)} disabled={totalM === 0} style={btnStyle()}>
              Save current
            </button>
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
                style={{ padding: '0.35rem 0.55rem', background: '#1e2329', color: '#e6e8eb', border: '1px solid #2a3038', borderRadius: 5, fontSize: '0.85rem', flex: 1 }}
              />
              <button onClick={saveRoute} disabled={!saveName.trim() || saveMutation.isPending} style={btnStyle()}>
                {saveMutation.isPending ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => { setSaveOpen(false); setSaveName(''); }} style={btnStyle()}>Cancel</button>
            </>
          )}
        </div>

        {savedRoutes.length === 0 && (
          <p style={{ color: '#8a93a0', fontSize: '0.85rem', margin: 0 }}>No saved routes yet.</p>
        )}

        {savedRoutes.map(r => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 0', borderBottom: '1px solid #2a3038', fontSize: '0.85rem' }}>
            <span style={{ flex: 1, color: '#e6e8eb', fontWeight: 500 }}>{r.name}</span>
            {r.totalDistanceM != null && (
              <span style={{ color: '#8a93a0' }}>{fmtDist(r.totalDistanceM)}</span>
            )}
            <span style={{ color: '#8a93a0' }}>{r.createdAt.slice(0, 10)}</span>
            <button onClick={() => void loadRoute(r)} style={btnStyle()}>Load</button>
            <button
              onClick={() => deleteMutation.mutate(r.id)}
              disabled={deleteMutation.isPending}
              style={{ ...btnStyle(), color: '#e66a5f', borderColor: '#3a2020' }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
