import type { CSSProperties } from 'react';

/**
 * MapLibre markers are raw DOM elements, not React nodes, so these are plain
 * factories rather than components. Keeping them here also keeps the planner's
 * inline-style soup out of the component that does the real work.
 */

const START_COLOUR = '#22c55e';
const END_COLOUR = '#ef4444';
const MID_COLOUR = '#5fa8e0';

/** Colour and label for waypoint `index` of `total`: S, E, or its number. */
export function waypointAppearance(index: number, total: number): { colour: string; label: string } {
  const isStart = index === 0;
  const isEnd = index === total - 1 && total > 1;
  return {
    colour: isStart ? START_COLOUR : isEnd ? END_COLOUR : MID_COLOUR,
    label: isStart ? 'S' : isEnd ? 'E' : String(index + 1),
  };
}

export function makeWaypointEl(index: number, total: number): HTMLDivElement {
  const { colour, label } = waypointAppearance(index, total);
  const el = document.createElement('div');
  el.style.cssText =
    `width:26px;height:26px;border-radius:50%;background:${colour};border:2.5px solid #fff;` +
    'box-shadow:0 2px 6px rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;' +
    'font-size:11px;font-weight:700;color:#fff;font-family:system-ui,sans-serif;cursor:grab';
  el.textContent = label;
  return el;
}

/** Repaints an existing marker in place — cheaper than rebuilding the DOM node. */
export function applyWaypointAppearance(el: HTMLDivElement, index: number, total: number): void {
  const { colour, label } = waypointAppearance(index, total);
  el.style.background = colour;
  el.textContent = label;
}

export function makeKmEl(label: string): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText =
    'background:#1e2329cc;color:#e6e8eb;border:1px solid #5fa8e0;border-radius:3px;padding:1px 5px;' +
    'font-size:11px;font-weight:600;white-space:nowrap;backdrop-filter:blur(2px);pointer-events:none';
  el.textContent = label;
  return el;
}

/** Compact toolbar button, highlighted when its mode is active. */
export function btnStyle(active?: boolean): CSSProperties {
  return {
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
    whiteSpace: 'nowrap',
  };
}

export const PANEL_STYLE: CSSProperties = {
  border: '1px solid #2a3038',
  borderRadius: 8,
  padding: '0.75rem',
  background: '#161a1f',
};
