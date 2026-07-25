import type * as echarts from 'echarts';
import type { SavedRoute } from '@fitness/shared';
import { useState } from 'react';
import type { SearchResult } from './plannerApi';
import { PANEL_STYLE, btnStyle } from './plannerMarkers';
import { fmtDist, type ElevPoint } from './plannerGeo';

/** Presentational pieces of the planner. All state lives in the parent. */

export function PlannerSearch({
  query,
  results,
  open,
  onQueryChange,
  onSelect,
  onFocus,
}: {
  query: string;
  results: SearchResult[];
  open: boolean;
  onQueryChange: (q: string) => void;
  onSelect: (r: SearchResult) => void;
  onFocus: () => void;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <span
          style={{
            position: 'absolute',
            left: '0.6rem',
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: '0.9rem',
            pointerEvents: 'none',
          }}
        >
          🔍
        </span>
        <input
          type="text"
          placeholder="Search for a location…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={onFocus}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '0.45rem 0.6rem 0.45rem 2rem',
            background: '#1e2329',
            color: '#e6e8eb',
            border: '1px solid #2a3038',
            borderRadius: 6,
            fontSize: '0.9rem',
          }}
        />
      </div>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 1000,
            background: '#1e2329',
            border: '1px solid #2a3038',
            borderRadius: 6,
            marginTop: 3,
            boxShadow: '0 4px 16px rgba(0,0,0,.4)',
          }}
        >
          {results.map((r) => (
            <div
              key={r.placeId}
              onClick={() => onSelect(r)}
              style={{
                padding: '0.45rem 0.75rem',
                cursor: 'pointer',
                fontSize: '0.85rem',
                color: '#e6e8eb',
                borderBottom: '1px solid #2a3038',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#2a3038')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {r.displayName}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function StatCard({ label, value, colour }: { label: string; value: string; colour?: string }) {
  return (
    <div
      style={{
        background: '#1e2329',
        border: '1px solid #2a3038',
        borderRadius: 6,
        padding: '0.45rem 0.85rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        minWidth: 80,
      }}
    >
      <span style={{ fontSize: '1rem', fontWeight: 700, color: colour ?? '#e6e8eb' }}>{value}</span>
      <span style={{ fontSize: '0.7rem', color: '#8a93a0', marginTop: 1 }}>{label}</span>
    </div>
  );
}

export function SavedRoutesPanel({
  routes,
  canSave,
  isSaving,
  isDeleting,
  onSave,
  onLoad,
  onDelete,
}: {
  routes: SavedRoute[];
  canSave: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  onSave: (name: string) => void;
  onLoad: (route: SavedRoute) => void;
  onDelete: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const commit = () => {
    if (!name.trim() || !canSave) return;
    onSave(name.trim());
    setName('');
    setOpen(false);
  };

  return (
    <div style={PANEL_STYLE}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.6rem' }}>
        <strong style={{ color: '#e6e8eb', fontSize: '0.9rem' }}>💾 Saved routes</strong>
        {!open && (
          <button onClick={() => setOpen(true)} disabled={!canSave} style={btnStyle()}>
            Save current
          </button>
        )}
        {open && (
          <>
            <input
              type="text"
              placeholder="Route name…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
              autoFocus
              style={{
                padding: '0.35rem 0.55rem',
                background: '#1e2329',
                color: '#e6e8eb',
                border: '1px solid #2a3038',
                borderRadius: 5,
                fontSize: '0.85rem',
                flex: 1,
              }}
            />
            <button onClick={commit} disabled={!name.trim() || isSaving} style={btnStyle()}>
              {isSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setName('');
              }}
              style={btnStyle()}
            >
              Cancel
            </button>
          </>
        )}
      </div>

      {routes.length === 0 && (
        <p style={{ color: '#8a93a0', fontSize: '0.85rem', margin: 0 }}>No saved routes yet.</p>
      )}

      {routes.map((r) => (
        <div
          key={r.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            padding: '0.45rem 0',
            borderBottom: '1px solid #2a3038',
            fontSize: '0.85rem',
          }}
        >
          <span style={{ flex: 1, color: '#e6e8eb', fontWeight: 500 }}>{r.name}</span>
          {r.totalDistanceM != null && <span style={{ color: '#8a93a0' }}>{fmtDist(r.totalDistanceM)}</span>}
          <span style={{ color: '#8a93a0' }}>{r.createdAt.slice(0, 10)}</span>
          <button onClick={() => onLoad(r)} style={btnStyle()}>
            Load
          </button>
          <button
            onClick={() => onDelete(r.id)}
            disabled={isDeleting}
            style={{ ...btnStyle(), color: '#e66a5f', borderColor: '#3a2020' }}
          >
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}

export function elevationChartOption(elevation: ElevPoint[]): echarts.EChartsOption {
  return {
    backgroundColor: 'transparent',
    title: { text: 'Elevation profile', textStyle: { color: '#e6e8eb', fontSize: 13 }, left: 0, top: 4 },
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => `${v} m` },
    grid: { left: 52, right: 16, top: 36, bottom: 40 },
    xAxis: {
      type: 'value',
      name: 'km',
      nameLocation: 'end',
      axisLabel: { color: '#8a93a0' },
      splitLine: { lineStyle: { color: '#2a3038' } },
    },
    yAxis: {
      type: 'value',
      name: 'm',
      scale: true,
      axisLabel: { color: '#8a93a0' },
      splitLine: { lineStyle: { color: '#2a3038' } },
    },
    series: [
      {
        type: 'line',
        data: elevation.map((p) => [+(p.distM / 1000).toFixed(3), +p.elevM.toFixed(1)]),
        showSymbol: false,
        areaStyle: { color: 'rgba(95,206,110,0.18)' },
        lineStyle: { width: 1.5, color: '#5fce6e' },
        itemStyle: { color: '#5fce6e' },
      },
    ],
  };
}
