/** Geometry and formatting for the route planner. No React, no map library. */

/** [lng, lat] — the GeoJSON / MapLibre argument order, not lat-first. */
export type LngLat = [number, number];

export interface Segment {
  from: number;
  to: number;
  distanceM: number;
  coords: LngLat[];
}

export interface ElevPoint {
  distM: number;
  elevM: number;
}

const EARTH_RADIUS_M = 6371000;

export function haversineM([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Evenly spaced subset of at most `max` items, always keeping first and last. */
export function sampleEvenly<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = (arr.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => arr[Math.round(i * step)]!);
}

/**
 * Flattens segments into one cumulative-distance track, dropping the duplicated
 * join point where each segment starts where the previous one ended.
 */
export function cumulativeTrack(segments: Segment[]): { lnglat: LngLat; cumM: number }[] {
  const points: { lnglat: LngLat; cumM: number }[] = [];
  let cumulative = 0;
  for (const segment of segments) {
    for (let i = 0; i < segment.coords.length; i++) {
      if (i === 0 && points.length > 0) continue;
      if (points.length > 0) {
        cumulative += haversineM(points[points.length - 1]!.lnglat, segment.coords[i]!);
      }
      points.push({ lnglat: segment.coords[i]!, cumM: cumulative });
    }
  }
  return points;
}

/** Positions of each whole-kilometre mark, interpolated along the track. */
export function kilometreMarks(points: { lnglat: LngLat; cumM: number }[]): { km: number; lnglat: LngLat }[] {
  const total = points[points.length - 1]?.cumM ?? 0;
  const marks: { km: number; lnglat: LngLat }[] = [];
  for (let km = 1; km <= Math.floor(total / 1000); km++) {
    const target = km * 1000;
    const index = points.findIndex((p) => p.cumM >= target);
    if (index <= 0) continue;
    const a = points[index - 1]!;
    const b = points[index]!;
    const t = (target - a.cumM) / (b.cumM - a.cumM);
    marks.push({
      km,
      lnglat: [
        a.lnglat[0] + (b.lnglat[0] - a.lnglat[0]) * t,
        a.lnglat[1] + (b.lnglat[1] - a.lnglat[1]) * t,
      ],
    });
  }
  return marks;
}

export function totalAscentDescent(points: ElevPoint[]): { gain: number; loss: number } {
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < points.length; i++) {
    const diff = points[i]!.elevM - points[i - 1]!.elevM;
    if (diff > 0) gain += diff;
    else loss += Math.abs(diff);
  }
  return { gain: Math.round(gain), loss: Math.round(loss) };
}

export function fmtDist(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

export function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(sec).padStart(2, '0')}s`;
}

export function fmtPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')} /km`;
}

/** "m:ss" → seconds per km. Null when the text isn't a valid pace. */
export function parsePaceInput(value: string): number | null {
  const match = value.match(/^(\d+):(\d{0,2})$/);
  if (!match) return null;
  const minutes = Number.parseInt(match[1]!, 10);
  const seconds = Number.parseInt(match[2] || '0', 10);
  if (Number.isNaN(minutes) || Number.isNaN(seconds) || seconds >= 60) return null;
  return minutes * 60 + seconds;
}

export function formatPaceInput(secPerKm: number): string {
  return `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, '0')}`;
}

/** A GPX track of the planned route, for loading onto a watch. */
export function buildGpx(segments: Segment[]): string {
  const all: LngLat[] = [];
  for (const segment of segments) {
    for (let i = 0; i < segment.coords.length; i++) {
      if (i === 0 && all.length > 0) continue;
      all.push(segment.coords[i]!);
    }
  }
  const trkpts = all
    .map(([lng, lat]) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"></trkpt>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Fitness Data Visualiser" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Planned Route</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}
