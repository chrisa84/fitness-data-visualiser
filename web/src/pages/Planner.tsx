import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type TileStyle, TILE_STYLE_URLS, TILE_STYLE_LABELS, TILE_STYLES, DEFAULT_TILE_STYLE } from '../tileStyles';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type * as echarts from 'echarts';
import type { SavedRoute } from '@fitness/shared';
import { fetchActivities, fetchRoutes, createSavedRoute, deleteSavedRoute } from '../api';
import Chart from '../Chart';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LngLat = [number, number]; // [lng, lat] — GeoJSON / MapLibre convention

interface Waypoint { lnglat: LngLat; marker: maplibregl.Marker; el: HTMLDivElement }
interface Segment  { from: number; to: number; distanceM: number; coords: LngLat[] }
interface SearchResult { placeId: number; displayName: string; lat: number; lon: number }
interface ElevPoint { distM: number; elevM: number }


// ---------------------------------------------------------------------------
// External APIs
// ---------------------------------------------------------------------------

const OSRM      = 'https://router.project-osrm.org/route/v1/foot';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const TOPO_API  = '/api/elevation';

const LS_MAP_VIEW = 'planner-map-view';
const LS_PACE     = 'planner-pace-sec';

function getStoredMapView(): { center: [number, number]; zoom: number } | null {
  try { return JSON.parse(localStorage.getItem(LS_MAP_VIEW) ?? 'null'); } catch { return null; }
}
function saveMapView(center: [number, number], zoom: number) {
  try { localStorage.setItem(LS_MAP_VIEW, JSON.stringify({ center, zoom })); } catch {}
}
function getStoredPace(): number | null {
  try { const v = localStorage.getItem(LS_PACE); return v ? Number(v) : null; } catch { return null; }
}
function savePace(sec: number) {
  try { localStorage.setItem(LS_PACE, String(sec)); } catch {}
}

async function osrmRoute(a: LngLat, b: LngLat): Promise<{ coords: LngLat[]; distanceM: number } | null> {
  try {
    const res = await fetch(`${OSRM}/${a[0]},${a[1]};${b[0]},${b[1]}?overview=full&geometries=geojson`);
    if (!res.ok) return null;
    const json = await res.json();
    const route = json.routes?.[0];
    if (!route) return null;
    return {
      coords: route.geometry.coordinates as LngLat[], // already [lng, lat]
      distanceM: route.distance,
    };
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

async function fetchElevations(coords: LngLat[]): Promise<number[] | 'error'> {
  // proxied through /api/elevation to avoid CORS; opentopodata expects lat,lng order
  const locs = coords.map(([lng, lat]) => `${lat.toFixed(6)},${lng.toFixed(6)}`).join('|');
  try {
    const res = await fetch(`${TOPO_API}?locations=${locs}`);
    if (!res.ok) {
      console.error('opentopodata HTTP error', res.status, await res.text().catch(() => ''));
      return 'error';
    }
    const json = await res.json();
    if (json.status !== 'OK') {
      console.error('opentopodata non-OK status', json);
      return 'error';
    }
    return (json.results as { elevation: number }[]).map(r => r.elevation ?? 0);
  } catch (e) {
    console.error('opentopodata fetch failed', e);
    return 'error';
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function haversineM([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
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
// DOM element factories for MapLibre Markers
// ---------------------------------------------------------------------------

function makeWaypointEl(index: number, total: number): HTMLDivElement {
  const isStart = index === 0;
  const isEnd   = index === total - 1 && total > 1;
  const bg      = isStart ? '#22c55e' : isEnd ? '#ef4444' : '#5fa8e0';
  const label   = isStart ? 'S' : isEnd ? 'E' : String(index + 1);
  const el      = document.createElement('div');
  el.style.cssText = `width:26px;height:26px;border-radius:50%;background:${bg};border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;font-family:system-ui,sans-serif;cursor:grab`;
  el.textContent = label;
  return el;
}

function makeKmEl(label: string): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `background:#1e2329cc;color:#e6e8eb;border:1px solid #5fa8e0;border-radius:3px;padding:1px 5px;font-size:11px;font-weight:600;white-space:nowrap;backdrop-filter:blur(2px);pointer-events:none`;
  el.textContent = label;
  return el;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Planner() {
  const containerRef   = useRef<HTMLDivElement>(null);
  const mapRef         = useRef<maplibregl.Map | null>(null);
  const waypointsRef   = useRef<Waypoint[]>([]);
  const segmentsRef    = useRef<Segment[]>([]);
  const redoStackRef   = useRef<LngLat[]>([]);
  const kmMarkersRef   = useRef<maplibregl.Marker[]>([]);
  const snapRef        = useRef(true);
  const buildSegRef    = useRef<(f: number, t: number) => Promise<void>>(async () => {});
  const elevTimerRef   = useRef<ReturnType<typeof setTimeout>>();
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const [totalM,        setTotalM]        = useState(0);
  const [snap,          setSnap]          = useState(true);
  const [routing,       setRouting]       = useState(false);
  const [paceSec,       setPaceSec]       = useState(() => getStoredPace() ?? 360);
  const [segVersion,    setSegVersion]    = useState(0);
  const [elevation,     setElevation]     = useState<ElevPoint[]>([]);
  const [elevGain,      setElevGain]      = useState(0);
  const [elevLoss,      setElevLoss]      = useState(0);
  const [fetchingElev,  setFetchingElev]  = useState(false);
  const [elevError,     setElevError]     = useState(false);
  const [searchQuery,   setSearchQuery]   = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen,    setSearchOpen]    = useState(false);
  const [saveName,      setSaveName]      = useState('');
  const [saveOpen,      setSaveOpen]      = useState(false);
  const [tileStyle,     setTileStyle]     = useState<TileStyle>(DEFAULT_TILE_STYLE);
  const [paceInput,     setPaceInput]     = useState(() => {
    const sec = getStoredPace() ?? 360;
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  });

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
    if (avgMps > 0) {
      const sec = Math.round(1000 / avgMps);
      setPaceSec(sec);
      setPaceInput(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
    }
  }, [activityData]);

  // ---------------------------------------------------------------------------
  // Route source update — writes current segments to MapLibre GeoJSON source
  // ---------------------------------------------------------------------------

  const updateRouteSource = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource('planner-route') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const features: GeoJSON.Feature[] = segmentsRef.current.map(seg => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: seg.coords },
    }));
    source.setData({ type: 'FeatureCollection', features });
  }, []);

  // ---------------------------------------------------------------------------
  // Marker icon refresh (updates existing DOM elements in place)
  // ---------------------------------------------------------------------------

  const updateMarkerIcons = useCallback(() => {
    const wps = waypointsRef.current;
    wps.forEach((wp, i) => {
      const isStart = i === 0;
      const isEnd   = i === wps.length - 1 && wps.length > 1;
      const bg      = isStart ? '#22c55e' : isEnd ? '#ef4444' : '#5fa8e0';
      wp.el.style.background = bg;
      wp.el.textContent = isStart ? 'S' : isEnd ? 'E' : String(i + 1);
    });
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

    const pts: { lnglat: LngLat; cumM: number }[] = [];
    let cumDist = 0;
    for (const seg of segs) {
      for (let i = 0; i < seg.coords.length; i++) {
        if (i === 0 && pts.length > 0) continue;
        if (pts.length > 0) cumDist += haversineM(pts[pts.length - 1]!.lnglat, seg.coords[i]!);
        pts.push({ lnglat: seg.coords[i]!, cumM: cumDist });
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
      const lng = a.lnglat[0] + (b.lnglat[0] - a.lnglat[0]) * t;
      const lat = a.lnglat[1] + (b.lnglat[1] - a.lnglat[1]) * t;
      const el = makeKmEl(`${km} km`);
      kmMarkersRef.current.push(
        new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map),
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
    updateRouteSource();
  }, [drawKmMarkers, updateRouteSource]);

  const removeSegment = useCallback((idx: number) => {
    segmentsRef.current.splice(idx, 1);
  }, []);

  const buildSegment = useCallback(async (fromIdx: number, toIdx: number) => {
    if (!mapRef.current) return;
    const a = waypointsRef.current[fromIdx]?.lnglat;
    const b = waypointsRef.current[toIdx]?.lnglat;
    if (!a || !b) return;

    const existing = segmentsRef.current.findIndex(s => s.from === fromIdx && s.to === toIdx);
    if (existing !== -1) removeSegment(existing);

    let coords: LngLat[];
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

    segmentsRef.current.push({ from: fromIdx, to: toIdx, distanceM, coords });
    recalcTotal();
  }, [removeSegment, recalcTotal]);

  useEffect(() => { buildSegRef.current = buildSegment; }, [buildSegment]);

  // ---------------------------------------------------------------------------
  // Waypoint management
  // ---------------------------------------------------------------------------

  const addWaypointAt = useCallback(async (lnglat: LngLat, clearRedo = true) => {
    const map = mapRef.current;
    if (!map) return;
    if (clearRedo) redoStackRef.current = [];

    const idx = waypointsRef.current.length;
    const el  = makeWaypointEl(idx, idx + 1);
    const marker = new maplibregl.Marker({ element: el, draggable: true })
      .setLngLat(lnglat)
      .addTo(map);
    waypointsRef.current.push({ lnglat, marker, el });
    updateMarkerIcons();

    marker.on('dragend', async () => {
      const pos = marker.getLngLat();
      const newLnglat: LngLat = [pos.lng, pos.lat];
      waypointsRef.current[idx]!.lnglat = newLnglat;
      const affected = segmentsRef.current
        .map((s, i) => (s.from === idx || s.to === idx ? i : -1))
        .filter(i => i !== -1)
        .reverse();
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
    redoStackRef.current.push(removed.lnglat);
    removed.marker.remove();
    wps.pop();
    const lastIdx = wps.length;
    const toRemove = segmentsRef.current
      .map((s, i) => (s.from === lastIdx || s.to === lastIdx ? i : -1))
      .filter(i => i !== -1)
      .reverse();
    for (const i of toRemove) removeSegment(i);
    updateMarkerIcons();
    recalcTotal();
  }, [removeSegment, recalcTotal, updateMarkerIcons]);

  const redoPoint = useCallback(async () => {
    const lnglat = redoStackRef.current.pop();
    if (!lnglat) return;
    await addWaypointAt(lnglat, false);
  }, [addWaypointAt]);

  const reverseRoute = useCallback(async () => {
    if (waypointsRef.current.length < 2) return;
    segmentsRef.current = [];
    updateRouteSource();
    waypointsRef.current.reverse();
    updateMarkerIcons();
    for (let i = 0; i < waypointsRef.current.length - 1; i++) {
      await buildSegRef.current(i, i + 1);
    }
  }, [updateMarkerIcons, updateRouteSource]);

  const clearAll = useCallback(() => {
    for (const w of waypointsRef.current) w.marker.remove();
    for (const m of kmMarkersRef.current) m.remove();
    waypointsRef.current = [];
    segmentsRef.current  = [];
    kmMarkersRef.current = [];
    redoStackRef.current = [];
    setTotalM(0);
    setElevation([]);
    setElevGain(0);
    setElevLoss(0);
    setSegVersion(v => v + 1);
    updateRouteSource();
  }, [updateRouteSource]);

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
      waypoints: waypointsRef.current.map(w => ({ lat: w.lnglat[1], lng: w.lnglat[0] })),
      snap,
      totalDistanceM: totalM,
    });
  }, [saveName, totalM, snap, saveMutation]);

  const loadRoute = useCallback(async (route: SavedRoute) => {
    clearAll();
    snapRef.current = route.snap;
    setSnap(route.snap);
    for (const wp of route.waypoints) {
      await addWaypointAt([wp.lng, wp.lat], false);
    }
  }, [clearAll, addWaypointAt]);

  // ---------------------------------------------------------------------------
  // Rebuild segments when snap toggles
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (waypointsRef.current.length < 2) return;
    const rebuild = async () => {
      segmentsRef.current = [];
      updateRouteSource();
      for (let i = 0; i < waypointsRef.current.length - 1; i++) {
        await buildSegRef.current(i, i + 1);
      }
    };
    rebuild();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap]);

  // ---------------------------------------------------------------------------
  // Elevation profile (debounced)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    clearTimeout(elevTimerRef.current);
    if (!segmentsRef.current.length) {
      setElevation([]); setElevGain(0); setElevLoss(0); setElevError(false);
      return;
    }
    elevTimerRef.current = setTimeout(async () => {
      const pts: { lnglat: LngLat; cumM: number }[] = [];
      let cum = 0;
      for (const seg of segmentsRef.current) {
        for (let i = 0; i < seg.coords.length; i++) {
          if (i === 0 && pts.length > 0) continue;
          if (pts.length > 0) cum += haversineM(pts[pts.length - 1]!.lnglat, seg.coords[i]!);
          pts.push({ lnglat: seg.coords[i]!, cumM: cum });
        }
      }
      const sampled = sampleEvenly(pts, 60);
      setFetchingElev(true);
      setElevError(false);
      const elevs = await fetchElevations(sampled.map(p => p.lnglat));
      setFetchingElev(false);
      if (elevs === 'error') { setElevError(true); return; }
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
    const all: LngLat[] = [];
    for (const seg of segs) {
      for (let i = 0; i < seg.coords.length; i++) {
        if (i === 0 && all.length > 0) continue;
        all.push(seg.coords[i]!);
      }
    }
    const trkpts = all
      .map(([lng, lat]) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"></trkpt>`)
      .join('\n');
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
    mapRef.current?.flyTo({ center: [r.lon, r.lat], zoom: 14 });
    setSearchQuery(r.displayName.split(',')[0] ?? r.displayName);
    setSearchResults([]);
    setSearchOpen(false);
  }, []);

  const findMyLocation = useCallback(() => {
    navigator.geolocation?.getCurrentPosition(
      pos => mapRef.current?.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 15 }),
      () => {},
    );
  }, []);

  // ---------------------------------------------------------------------------
  // Map init
  // ---------------------------------------------------------------------------

  const addWaypointRef = useRef(addWaypointAt);
  useEffect(() => { addWaypointRef.current = addWaypointAt; }, [addWaypointAt]);

  const updateRouteSourceRef = useRef(updateRouteSource);
  useEffect(() => { updateRouteSourceRef.current = updateRouteSource; }, [updateRouteSource]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const stored = getStoredMapView();
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: TILE_STYLE_URLS[DEFAULT_TILE_STYLE],
      center: stored?.center ?? [-0.09, 51.505],
      zoom:   stored?.zoom   ?? 13,
    });
    mapRef.current = map;

    map.on('moveend', () => {
      const c = map.getCenter();
      saveMapView([c.lng, c.lat], map.getZoom());
    });

    map.on('style.load', () => {
      if (!map.getSource('planner-route')) {
        map.addSource('planner-route', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getLayer('planner-route-layer')) {
        map.addLayer({
          id: 'planner-route-layer',
          type: 'line',
          source: 'planner-route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#5fa8e0', 'line-width': 5, 'line-opacity': 0.9 },
        });
      }
      // Repopulate after style swap (markers survive setStyle, route source does not).
      updateRouteSourceRef.current();
    });

    // Only geolocate on first visit (no stored position).
    if (!stored) {
      navigator.geolocation?.getCurrentPosition(
        pos => map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 14 }),
        () => {},
      );
    }

    map.on('click', async e => {
      await addWaypointRef.current([e.lngLat.lng, e.lngLat.lat]);
    });

    return () => { map.remove(); mapRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Tile style switching — setStyle triggers style.load which re-adds source/layer
  // ---------------------------------------------------------------------------

  const switchTileStyle = useCallback((style: TileStyle) => {
    setTileStyle(style);
    mapRef.current?.setStyle(TILE_STYLE_URLS[style]);
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

  const commitPaceInput = (val: string) => {
    const m = val.match(/^(\d+):(\d{0,2})$/);
    if (m) {
      const mins = parseInt(m[1]!, 10);
      const secs = parseInt(m[2] || '0', 10);
      if (!isNaN(mins) && !isNaN(secs) && secs < 60) {
        const sec = mins * 60 + secs;
        setPaceSec(sec);
        savePace(sec);
        setPaceInput(`${mins}:${String(secs).padStart(2, '0')}`);
        return;
      }
    }
    setPaceInput(`${Math.floor(paceSec / 60)}:${String(paceSec % 60).padStart(2, '0')}`);
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
            value={paceInput}
            onChange={e => setPaceInput(e.target.value)}
            onBlur={e => commitPaceInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && commitPaceInput(e.currentTarget.value)}
            style={{ width: '3.6rem', textAlign: 'center', background: 'transparent', border: 'none', color: '#e6e8eb', fontSize: '0.85rem', outline: 'none' }}
          />
          <span style={{ color: '#8a93a0', fontSize: '0.75rem' }}>/km</span>
        </div>

        <div style={{ width: 1, height: 22, background: '#2a3038', margin: '0 0.1rem' }} />

        {/* Action buttons */}
        <button onClick={findMyLocation} style={btnStyle()} title="Centre on my location">📍 Locate</button>
        <button onClick={undoLast}       style={btnStyle()} title="Undo last point">↩ Undo</button>
        <button onClick={redoPoint}      style={btnStyle()} title="Redo">↪ Redo</button>
        <button onClick={reverseRoute}   style={btnStyle()} title="Reverse route">⇅ Reverse</button>
        <button onClick={exportGpx}      style={btnStyle()} disabled={totalM === 0} title="Export GPX">⬇ GPX</button>
        <button onClick={clearAll}       style={{ ...btnStyle(), color: '#e66a5f' }} title="Clear all">✕ Clear</button>

        <div style={{ width: 1, height: 22, background: '#2a3038', margin: '0 0.1rem' }} />

        {/* Tile switcher */}
        {TILE_STYLES.map(t => (
          <button key={t} onClick={() => switchTileStyle(t)} style={btnStyle(tileStyle === t)}>
            {TILE_STYLE_LABELS[t]}
          </button>
        ))}

        {/* Status */}
        {routing      && <span style={{ color: '#8a93a0', fontSize: '0.8rem', marginLeft: 4 }}>Routing…</span>}
        {fetchingElev && <span style={{ color: '#8a93a0', fontSize: '0.8rem', marginLeft: 4 }}>Elevation…</span>}
        {elevError    && <span style={{ color: '#e66a5f', fontSize: '0.8rem', marginLeft: 4 }}>Elevation unavailable</span>}
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
