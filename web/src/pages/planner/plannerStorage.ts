/**
 * Per-device planner preferences. localStorage rather than the events DB: a map
 * position and a default pace are display state, and losing them costs nothing.
 */

const LS_MAP_VIEW = 'planner-map-view';
const LS_PACE = 'planner-pace-sec';

export interface MapView {
  center: [number, number];
  zoom: number;
}

export function getStoredMapView(): MapView | null {
  try {
    return JSON.parse(localStorage.getItem(LS_MAP_VIEW) ?? 'null');
  } catch {
    return null;
  }
}

export function saveMapView(center: [number, number], zoom: number): void {
  try {
    localStorage.setItem(LS_MAP_VIEW, JSON.stringify({ center, zoom }));
  } catch {
    // ignore — the map just opens at the default next time
  }
}

export function getStoredPace(): number | null {
  try {
    const v = localStorage.getItem(LS_PACE);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function savePace(sec: number): void {
  try {
    localStorage.setItem(LS_PACE, String(sec));
  } catch {
    // ignore
  }
}
