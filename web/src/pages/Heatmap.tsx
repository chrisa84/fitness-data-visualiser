import { useQuery } from '@tanstack/react-query';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ACTIVITY_GROUPS, GROUP_PREFIX, resolveActivityTypeFilter, type HeatmapEntry } from '@fitness/shared';
import { fetchHeatmap, fetchHeatmapStatus } from '../api';
import { decodePolyline } from '../polyline';
import { type TileStyle, tileStyleUrl, defaultTileStyle, TILE_STYLE_LABELS, TILE_STYLES } from '../tileStyles';
import { useConfig } from '../useConfig';

const LINE_COLOR = '#e66a5f';

function buildGeoJSON(entries: HeatmapEntry[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: entries.map((e) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: decodePolyline(e.polyline) },
    })),
  };
}

function boundsOf(entries: HeatmapEntry[]): maplibregl.LngLatBounds | null {
  let bounds: maplibregl.LngLatBounds | null = null;
  for (const e of entries) {
    for (const coord of decodePolyline(e.polyline)) {
      if (!bounds) bounds = new maplibregl.LngLatBounds(coord, coord);
      else bounds.extend(coord);
    }
  }
  return bounds;
}

export default function Heatmap() {
  const { stadiaApiKey } = useConfig();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map>();
  const fittedRef = useRef(false);
  const [tileStyle, setTileStyle] = useState<TileStyle>(() => defaultTileStyle(stadiaApiKey));
  const [typeFilter, setTypeFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');

  const heatmap = useQuery({ queryKey: ['heatmap'], queryFn: fetchHeatmap });
  const backfilling = heatmap.data != null && !heatmap.data.ready;
  const status = useQuery({
    queryKey: ['heatmap-status'],
    queryFn: fetchHeatmapStatus,
    enabled: backfilling,
    refetchInterval: 2000,
  });

  // Refetch tracks once the initial backfill completes.
  useEffect(() => {
    if (backfilling && status.data && status.data.processed >= status.data.total && !status.data.running) {
      void heatmap.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.data, backfilling]);

  const entries = useMemo(() => heatmap.data?.entries ?? [], [heatmap.data]);

  const typeOptions = useMemo(() => {
    const present = new Set(entries.map((e) => e.type).filter((t): t is string => t != null));
    const groups = ACTIVITY_GROUPS.filter((g) => g.types.some((t) => present.has(t)));
    return { groups, types: [...present].sort() };
  }, [entries]);

  const yearOptions = useMemo(
    () => [...new Set(entries.map((e) => e.date.slice(0, 4)))].sort().reverse(),
    [entries],
  );

  const filtered = useMemo(() => {
    const types = resolveActivityTypeFilter(typeFilter || undefined);
    return entries.filter(
      (e) =>
        (types == null || (e.type != null && types.includes(e.type))) &&
        (yearFilter === '' || e.date.startsWith(yearFilter)),
    );
  }, [entries, typeFilter, yearFilter]);

  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;

  // Init the map once; tracks are (re)applied on style.load and when filters change.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: tileStyleUrl(defaultTileStyle(stadiaApiKey), stadiaApiKey),
      center: [0, 30],
      zoom: 1.5,
    });
    mapRef.current = map;

    map.on('style.load', () => {
      if (!map.getSource('tracks')) {
        map.addSource('tracks', { type: 'geojson', data: buildGeoJSON(filteredRef.current) });
      }
      if (!map.getLayer('tracks-line')) {
        map.addLayer({
          id: 'tracks-line',
          type: 'line',
          source: 'tracks',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': LINE_COLOR, 'line-width': 2, 'line-opacity': 0.22 },
        });
      }
    });

    return () => {
      map.remove();
      mapRef.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply data whenever the filtered set changes; fit bounds on first data.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource('tracks') as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(buildGeoJSON(filtered));
    if (!fittedRef.current && filtered.length > 0) {
      const bounds = boundsOf(filtered);
      if (bounds) {
        map.fitBounds(bounds, { padding: 32, animate: false });
        fittedRef.current = true;
      }
    }
  }, [filtered]);

  const progress = status.data ?? (heatmap.data && !heatmap.data.ready ? undefined : null);

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Heatmap</h2>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          style={{ background: '#1e2329', color: '#e6e8eb', border: '1px solid #2a3038', borderRadius: 4, padding: '2px 6px', fontSize: 13 }}
        >
          <option value="">All types</option>
          {typeOptions.groups.map((g) => (
            <option key={g.key} value={`${GROUP_PREFIX}${g.key}`}>{g.label}</option>
          ))}
          {typeOptions.types.map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
          style={{ background: '#1e2329', color: '#e6e8eb', border: '1px solid #2a3038', borderRadius: 4, padding: '2px 6px', fontSize: 13 }}
        >
          <option value="">All years</option>
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <span style={{ fontSize: 13, color: '#8b94a1' }}>
          {filtered.length} {filtered.length === 1 ? 'track' : 'tracks'}
        </span>
        {backfilling && (
          <span style={{ fontSize: 13, color: '#8b94a1' }}>
            Processing GPS tracks{progress ? ` — ${progress.processed} of ${progress.total}` : ''}…
          </span>
        )}
        <div style={{ display: 'flex', gap: '0.3rem', marginLeft: 'auto' }}>
          {TILE_STYLES.map((t) => (
            <button
              key={t}
              onClick={() => { setTileStyle(t); mapRef.current?.setStyle(tileStyleUrl(t, stadiaApiKey)); }}
              style={{
                padding: '2px 8px',
                fontSize: 12,
                borderRadius: 4,
                border: tileStyle === t ? '1px solid #5fa8e0' : '1px solid #2a3038',
                background: tileStyle === t ? '#1a3a52' : '#1e2329',
                color: tileStyle === t ? '#5fa8e0' : '#c0c7d0',
                cursor: 'pointer',
              }}
            >
              {TILE_STYLE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
      {heatmap.isLoading && <p>Loading tracks…</p>}
      {heatmap.isError && <p className="error">Failed to load heatmap: {(heatmap.error as Error).message}</p>}
      <div
        ref={containerRef}
        style={{ width: '100%', height: 'calc(100vh - 180px)', minHeight: 400, borderRadius: 6, overflow: 'hidden' }}
      />
    </section>
  );
}
