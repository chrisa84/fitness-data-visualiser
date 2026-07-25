import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SavedRoute } from '@fitness/shared';
import { fetchActivities, fetchRoutes, createSavedRoute, deleteSavedRoute } from '../api';
import Chart from '../Chart';
import { type TileStyle, tileStyleUrl, defaultTileStyle, TILE_STYLE_LABELS, TILE_STYLES } from '../tileStyles';
import { useConfig } from '../useConfig';
import { PlannerSearch, SavedRoutesPanel, StatCard, elevationChartOption } from './planner/PlannerPanels';
import { fetchElevations, nominatimSearch, osrmRoute, type SearchResult } from './planner/plannerApi';
import {
  type ElevPoint,
  type LngLat,
  type Segment,
  buildGpx,
  cumulativeTrack,
  fmtDist,
  fmtPace,
  fmtTime,
  formatPaceInput,
  haversineM,
  kilometreMarks,
  parsePaceInput,
  sampleEvenly,
  totalAscentDescent,
} from './planner/plannerGeo';
import { applyWaypointAppearance, btnStyle, makeKmEl, makeWaypointEl, PANEL_STYLE } from './planner/plannerMarkers';
import { getStoredMapView, getStoredPace, saveMapView, savePace } from './planner/plannerStorage';

/**
 * Draw a route on a map, get its distance and elevation profile, save it.
 *
 * The waypoint/segment model lives in refs rather than state: MapLibre markers
 * are imperative DOM objects with their own drag handlers, and re-rendering
 * React on every mouse move would fight the map. `segVersion` is the single
 * counter that tells React something changed. Everything that does *not* need
 * that model lives in `./planner/`.
 */

interface Waypoint {
  lnglat: LngLat;
  marker: maplibregl.Marker;
  el: HTMLDivElement;
}

/** Points sent to the elevation service — enough for a profile, few enough to be polite. */
const ELEVATION_SAMPLES = 60;
const ELEVATION_DEBOUNCE_MS = 1200;
const SEARCH_DEBOUNCE_MS = 400;
const DEFAULT_PACE_S = 360;

export default function Planner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const waypointsRef = useRef<Waypoint[]>([]);
  const segmentsRef = useRef<Segment[]>([]);
  const redoStackRef = useRef<LngLat[]>([]);
  const kmMarkersRef = useRef<maplibregl.Marker[]>([]);
  const snapRef = useRef(true);
  const buildSegRef = useRef<(f: number, t: number) => Promise<void>>(async () => {});
  const elevTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const [totalM, setTotalM] = useState(0);
  const [snap, setSnap] = useState(true);
  const [routing, setRouting] = useState(false);
  const [paceSec, setPaceSec] = useState(() => getStoredPace() ?? DEFAULT_PACE_S);
  const [segVersion, setSegVersion] = useState(0);
  const [elevation, setElevation] = useState<ElevPoint[]>([]);
  const [elevGain, setElevGain] = useState(0);
  const [elevLoss, setElevLoss] = useState(0);
  const [fetchingElev, setFetchingElev] = useState(false);
  const [elevError, setElevError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const { stadiaApiKey } = useConfig();
  const [tileStyle, setTileStyle] = useState<TileStyle>(() => defaultTileStyle(stadiaApiKey));
  const [paceInput, setPaceInput] = useState(() => formatPaceInput(getStoredPace() ?? DEFAULT_PACE_S));

  useEffect(() => {
    snapRef.current = snap;
  }, [snap]);

  // --- Pace seeded from recent runs -----------------------------------------

  const { data: activityData } = useQuery({
    queryKey: ['activities-pace'],
    queryFn: () => fetchActivities({ type: 'group:running', limit: 50, sort: 'start_time', order: 'desc' }),
  });

  useEffect(() => {
    if (!activityData) return;
    const runs = activityData.items.filter((a) => a.distanceM && a.distanceM > 1000 && a.avgSpeedMps);
    if (!runs.length) return;
    const avgMps = runs.reduce((s, a) => s + (a.avgSpeedMps ?? 0), 0) / runs.length;
    if (avgMps > 0) {
      const sec = Math.round(1000 / avgMps);
      setPaceSec(sec);
      setPaceInput(formatPaceInput(sec));
    }
  }, [activityData]);

  // --- Map sources and markers ----------------------------------------------

  const updateRouteSource = useCallback(() => {
    const source = mapRef.current?.getSource('planner-route') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData({
      type: 'FeatureCollection',
      features: segmentsRef.current.map((seg) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: seg.coords },
      })),
    });
  }, []);

  const updateMarkerIcons = useCallback(() => {
    const wps = waypointsRef.current;
    wps.forEach((wp, i) => applyWaypointAppearance(wp.el, i, wps.length));
  }, []);

  const drawKmMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of kmMarkersRef.current) m.remove();
    kmMarkersRef.current = [];
    if (!segmentsRef.current.length) return;

    for (const mark of kilometreMarks(cumulativeTrack(segmentsRef.current))) {
      kmMarkersRef.current.push(
        new maplibregl.Marker({ element: makeKmEl(`${mark.km} km`) }).setLngLat(mark.lnglat).addTo(map),
      );
    }
  }, []);

  // --- Segments -------------------------------------------------------------

  const recalcTotal = useCallback(() => {
    setTotalM(segmentsRef.current.reduce((s, seg) => s + seg.distanceM, 0));
    drawKmMarkers();
    setSegVersion((v) => v + 1);
    updateRouteSource();
  }, [drawKmMarkers, updateRouteSource]);

  const removeSegment = useCallback((idx: number) => {
    segmentsRef.current.splice(idx, 1);
  }, []);

  const buildSegment = useCallback(
    async (fromIdx: number, toIdx: number) => {
      if (!mapRef.current) return;
      const a = waypointsRef.current[fromIdx]?.lnglat;
      const b = waypointsRef.current[toIdx]?.lnglat;
      if (!a || !b) return;

      const existing = segmentsRef.current.findIndex((s) => s.from === fromIdx && s.to === toIdx);
      if (existing !== -1) removeSegment(existing);

      let coords: LngLat[];
      let distanceM: number;
      if (snapRef.current) {
        setRouting(true);
        ({ coords, distanceM } = await osrmRoute(a, b));
        setRouting(false);
      } else {
        coords = [a, b];
        distanceM = haversineM(a, b);
      }

      segmentsRef.current.push({ from: fromIdx, to: toIdx, distanceM, coords });
      recalcTotal();
    },
    [removeSegment, recalcTotal],
  );

  useEffect(() => {
    buildSegRef.current = buildSegment;
  }, [buildSegment]);

  // --- Waypoints ------------------------------------------------------------

  const addWaypointAt = useCallback(
    async (lnglat: LngLat, clearRedo = true) => {
      const map = mapRef.current;
      if (!map) return;
      if (clearRedo) redoStackRef.current = [];

      const idx = waypointsRef.current.length;
      const el = makeWaypointEl(idx, idx + 1);
      const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(lnglat).addTo(map);
      waypointsRef.current.push({ lnglat, marker, el });
      updateMarkerIcons();

      marker.on('dragend', async () => {
        const pos = marker.getLngLat();
        waypointsRef.current[idx]!.lnglat = [pos.lng, pos.lat];
        const affected = segmentsRef.current
          .map((s, i) => (s.from === idx || s.to === idx ? i : -1))
          .filter((i) => i !== -1)
          .reverse();
        for (const i of affected) removeSegment(i);
        if (idx > 0) await buildSegRef.current(idx - 1, idx);
        if (idx < waypointsRef.current.length - 1) await buildSegRef.current(idx, idx + 1);
      });

      if (idx > 0) await buildSegRef.current(idx - 1, idx);
    },
    [removeSegment, updateMarkerIcons],
  );

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
      .filter((i) => i !== -1)
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
    segmentsRef.current = [];
    kmMarkersRef.current = [];
    redoStackRef.current = [];
    setTotalM(0);
    setElevation([]);
    setElevGain(0);
    setElevLoss(0);
    setSegVersion((v) => v + 1);
    updateRouteSource();
  }, [updateRouteSource]);

  // --- Saved routes ---------------------------------------------------------

  const queryClient = useQueryClient();
  const { data: savedRoutes = [] } = useQuery({ queryKey: ['saved-routes'], queryFn: fetchRoutes });

  const saveMutation = useMutation({
    mutationFn: createSavedRoute,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['saved-routes'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSavedRoute,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['saved-routes'] }),
  });

  const saveRoute = useCallback(
    (name: string) => {
      if (totalM === 0) return;
      saveMutation.mutate({
        name,
        waypoints: waypointsRef.current.map((w) => ({ lat: w.lnglat[1], lng: w.lnglat[0] })),
        snap,
        totalDistanceM: totalM,
      });
    },
    [totalM, snap, saveMutation],
  );

  const loadRoute = useCallback(
    async (route: SavedRoute) => {
      clearAll();
      snapRef.current = route.snap;
      setSnap(route.snap);
      for (const wp of route.waypoints) {
        await addWaypointAt([wp.lng, wp.lat], false);
      }
    },
    [clearAll, addWaypointAt],
  );

  // Rebuild every segment when snapping is toggled — the geometry changes, not
  // just the styling.
  useEffect(() => {
    if (waypointsRef.current.length < 2) return;
    const rebuild = async () => {
      segmentsRef.current = [];
      updateRouteSource();
      for (let i = 0; i < waypointsRef.current.length - 1; i++) {
        await buildSegRef.current(i, i + 1);
      }
    };
    void rebuild();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap]);

  // --- Elevation profile (debounced: dragging a waypoint fires constantly) ---

  useEffect(() => {
    clearTimeout(elevTimerRef.current);
    if (!segmentsRef.current.length) {
      setElevation([]);
      setElevGain(0);
      setElevLoss(0);
      setElevError(false);
      return;
    }
    elevTimerRef.current = setTimeout(async () => {
      const sampled = sampleEvenly(cumulativeTrack(segmentsRef.current), ELEVATION_SAMPLES);
      setFetchingElev(true);
      setElevError(false);
      const elevs = await fetchElevations(sampled.map((p) => p.lnglat));
      setFetchingElev(false);
      if (elevs === 'error') {
        setElevError(true);
        return;
      }
      if (!elevs.length) return;
      const elevPts: ElevPoint[] = sampled.map((p, i) => ({ distM: p.cumM, elevM: elevs[i] ?? 0 }));
      setElevation(elevPts);
      const { gain, loss } = totalAscentDescent(elevPts);
      setElevGain(gain);
      setElevLoss(loss);
    }, ELEVATION_DEBOUNCE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segVersion]);

  const exportGpx = useCallback(() => {
    if (!segmentsRef.current.length) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([buildGpx(segmentsRef.current)], { type: 'application/gpx+xml' }),
    );
    a.download = 'route.gpx';
    a.click();
  }, []);

  // --- Location search ------------------------------------------------------

  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    clearTimeout(searchTimerRef.current);
    if (q.length < 3) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      const results = await nominatimSearch(q);
      setSearchResults(results);
      setSearchOpen(results.length > 0);
    }, SEARCH_DEBOUNCE_MS);
  }, []);

  const selectResult = useCallback((r: SearchResult) => {
    mapRef.current?.flyTo({ center: [r.lon, r.lat], zoom: 14 });
    setSearchQuery(r.displayName.split(',')[0] ?? r.displayName);
    setSearchResults([]);
    setSearchOpen(false);
  }, []);

  const findMyLocation = useCallback(() => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => mapRef.current?.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 15 }),
      () => {},
    );
  }, []);

  // --- Map init -------------------------------------------------------------

  const addWaypointRef = useRef(addWaypointAt);
  useEffect(() => {
    addWaypointRef.current = addWaypointAt;
  }, [addWaypointAt]);

  const updateRouteSourceRef = useRef(updateRouteSource);
  useEffect(() => {
    updateRouteSourceRef.current = updateRouteSource;
  }, [updateRouteSource]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const stored = getStoredMapView();
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: tileStyleUrl(defaultTileStyle(stadiaApiKey), stadiaApiKey),
      center: stored?.center ?? [-0.09, 51.505],
      zoom: stored?.zoom ?? 13,
    });
    mapRef.current = map;

    map.on('moveend', () => {
      const c = map.getCenter();
      saveMapView([c.lng, c.lat], map.getZoom());
    });

    map.on('style.load', () => {
      if (!map.getSource('planner-route')) {
        map.addSource('planner-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
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
      // Repopulate after a style swap: markers survive setStyle, sources do not.
      updateRouteSourceRef.current();
    });

    // Only geolocate on a first visit — otherwise the stored view wins.
    if (!stored) {
      navigator.geolocation?.getCurrentPosition(
        (pos) => map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 14 }),
        () => {},
      );
    }

    map.on('click', async (e) => {
      await addWaypointRef.current([e.lngLat.lng, e.lngLat.lat]);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchTileStyle = useCallback(
    (style: TileStyle) => {
      setTileStyle(style);
      mapRef.current?.setStyle(tileStyleUrl(style, stadiaApiKey));
    },
    [stadiaApiKey],
  );

  // The runtime key arrives after mount (config fetch), so upgrade to Outdoors
  // then — unless the user has already picked something else.
  const prevKeyRef = useRef('');
  useEffect(() => {
    if (!stadiaApiKey || stadiaApiKey === prevKeyRef.current) return;
    prevKeyRef.current = stadiaApiKey;
    if (tileStyle === 'liberty') switchTileStyle('outdoors');
  }, [stadiaApiKey, tileStyle, switchTileStyle]);

  // --- Render ---------------------------------------------------------------

  const elevOption = useMemo(() => elevationChartOption(elevation), [elevation]);
  const estimatedSeconds = paceSec > 0 && totalM > 0 ? (totalM / 1000) * paceSec : 0;

  const commitPaceInput = (value: string) => {
    const parsed = parsePaceInput(value);
    if (parsed != null) {
      setPaceSec(parsed);
      savePace(parsed);
      setPaceInput(formatPaceInput(parsed));
      return;
    }
    setPaceInput(formatPaceInput(paceSec));
  };

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
      <PlannerSearch
        query={searchQuery}
        results={searchResults}
        open={searchOpen}
        onQueryChange={handleSearch}
        onSelect={selectResult}
        onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
        <button
          onClick={() => setSnap((s) => !s)}
          style={{ ...btnStyle(snap), fontWeight: snap ? 600 : 400 }}
          title="Toggle snap to paths"
        >
          {snap ? '🛤️' : '✏️'} {snap ? 'Snap on' : 'Freehand'}
        </button>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            background: '#1e2329',
            border: '1px solid #2a3038',
            borderRadius: 5,
            padding: '0.2rem 0.55rem',
          }}
        >
          <span style={{ fontSize: '0.8rem', color: '#8a93a0' }}>⏱️</span>
          <input
            type="text"
            value={paceInput}
            onChange={(e) => setPaceInput(e.target.value)}
            onBlur={(e) => commitPaceInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && commitPaceInput(e.currentTarget.value)}
            style={{
              width: '3.6rem',
              textAlign: 'center',
              background: 'transparent',
              border: 'none',
              color: '#e6e8eb',
              fontSize: '0.85rem',
              outline: 'none',
            }}
          />
          <span style={{ color: '#8a93a0', fontSize: '0.75rem' }}>/km</span>
        </div>

        <div style={{ width: 1, height: 22, background: '#2a3038', margin: '0 0.1rem' }} />

        <button onClick={findMyLocation} style={btnStyle()} title="Centre on my location">
          📍 Locate
        </button>
        <button onClick={undoLast} style={btnStyle()} title="Undo last point">
          ↩ Undo
        </button>
        <button onClick={redoPoint} style={btnStyle()} title="Redo">
          ↪ Redo
        </button>
        <button onClick={reverseRoute} style={btnStyle()} title="Reverse route">
          ⇅ Reverse
        </button>
        <button onClick={exportGpx} style={btnStyle()} disabled={totalM === 0} title="Export GPX">
          ⬇ GPX
        </button>
        <button onClick={clearAll} style={{ ...btnStyle(), color: '#e66a5f' }} title="Clear all">
          ✕ Clear
        </button>

        <div style={{ width: 1, height: 22, background: '#2a3038', margin: '0 0.1rem' }} />

        {TILE_STYLES.map((t) => (
          <button key={t} onClick={() => switchTileStyle(t)} style={btnStyle(tileStyle === t)}>
            {TILE_STYLE_LABELS[t]}
          </button>
        ))}

        {routing && <span style={{ color: '#8a93a0', fontSize: '0.8rem', marginLeft: 4 }}>Routing…</span>}
        {fetchingElev && (
          <span style={{ color: '#8a93a0', fontSize: '0.8rem', marginLeft: 4 }}>Elevation…</span>
        )}
        {elevError && (
          <span style={{ color: '#e66a5f', fontSize: '0.8rem', marginLeft: 4 }}>Elevation unavailable</span>
        )}
      </div>

      {totalM > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <StatCard label="Distance" value={fmtDist(totalM)} />
          {estimatedSeconds > 0 && <StatCard label="Est. time" value={fmtTime(estimatedSeconds)} />}
          {estimatedSeconds > 0 && <StatCard label="Pace" value={fmtPace(paceSec)} colour="#8a93a0" />}
          {elevGain > 0 && <StatCard label="Ascent" value={`↑ ${elevGain} m`} colour="#5fce6e" />}
          {elevLoss > 0 && <StatCard label="Descent" value={`↓ ${elevLoss} m`} colour="#e66a5f" />}
        </div>
      )}

      <div
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: '520px',
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid #2a3038',
        }}
      />

      {elevation.length > 1 && (
        <div style={{ ...PANEL_STYLE, padding: '0.5rem' }}>
          <Chart option={elevOption} height={180} />
        </div>
      )}

      <SavedRoutesPanel
        routes={savedRoutes}
        canSave={totalM > 0}
        isSaving={saveMutation.isPending}
        isDeleting={deleteMutation.isPending}
        onSave={saveRoute}
        onLoad={(route) => void loadRoute(route)}
        onDelete={(id) => deleteMutation.mutate(id)}
      />
    </div>
  );
}
