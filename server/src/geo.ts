/**
 * Track geometry helpers for the heatmap / route features: Douglas-Peucker
 * simplification (metric tolerance) and Google encoded-polyline encoding at
 * the standard 1e-5 precision.
 */

/** [lat, lon] in degrees. */
export type LatLon = [number, number];

const M_PER_DEG_LAT = 111_320;

/**
 * Perpendicular distance in metres from `p` to the segment `a`-`b`, using an
 * equirectangular projection anchored at `a` — accurate to well under the
 * simplification tolerance at activity-track scale.
 */
function perpendicularDistanceM(p: LatLon, a: LatLon, b: LatLon): number {
  const cosLat = Math.cos((a[0] * Math.PI) / 180);
  const px = p[1] * cosLat * M_PER_DEG_LAT;
  const py = p[0] * M_PER_DEG_LAT;
  const ax = a[1] * cosLat * M_PER_DEG_LAT;
  const ay = a[0] * M_PER_DEG_LAT;
  const bx = b[1] * cosLat * M_PER_DEG_LAT;
  const by = b[0] * M_PER_DEG_LAT;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Douglas-Peucker simplification with a metric tolerance, followed by a
 * uniform downsample to `maxPoints` as a hard cap for pathological tracks.
 */
export function simplifyTrack(points: LatLon[], toleranceM: number, maxPoints: number): LatLon[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    if (hi - lo < 2) continue;
    let maxDist = -1;
    let maxIdx = -1;
    for (let i = lo + 1; i < hi; i += 1) {
      const d = perpendicularDistanceM(points[i]!, points[lo]!, points[hi]!);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > toleranceM) {
      keep[maxIdx] = 1;
      stack.push([lo, maxIdx], [maxIdx, hi]);
    }
  }
  let out = points.filter((_, i) => keep[i] === 1);
  if (out.length > maxPoints) {
    const step = (out.length - 1) / (maxPoints - 1);
    out = Array.from({ length: maxPoints }, (_, i) => out[Math.round(i * step)]!);
  }
  return out;
}

/** Minimum distance in metres from `p` to any segment of `track`. */
function minDistanceToTrackM(p: LatLon, track: LatLon[]): number {
  if (track.length === 1) return perpendicularDistanceM(p, track[0]!, track[0]!);
  let min = Infinity;
  for (let i = 0; i < track.length - 1; i += 1) {
    const d = perpendicularDistanceM(p, track[i]!, track[i + 1]!);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Symmetric mean nearest-point distance in metres between two simplified
 * tracks — the route-matching metric for Phase 19. Point-to-segment (not
 * point-to-vertex) so long straight segments with few vertices still compare
 * as close. Roughly 0 for the same route, and at least the lateral offset
 * for parallel-but-different paths.
 */
export function symmetricTrackDistanceM(a: LatLon[], b: LatLon[]): number {
  if (a.length === 0 || b.length === 0) return Infinity;
  const meanOneWay = (from: LatLon[], to: LatLon[]): number =>
    from.reduce((sum, p) => sum + minDistanceToTrackM(p, to), 0) / from.length;
  return (meanOneWay(a, b) + meanOneWay(b, a)) / 2;
}

function encodeValue(value: number, out: string[]): void {
  let n = value < 0 ? ~(value << 1) : value << 1;
  while (n >= 0x20) {
    out.push(String.fromCharCode((0x20 | (n & 0x1f)) + 63));
    n >>= 5;
  }
  out.push(String.fromCharCode(n + 63));
}

/** Google encoded polyline, precision 5. */
export function encodePolyline(points: LatLon[]): string {
  const out: string[] = [];
  let prevLat = 0;
  let prevLon = 0;
  for (const [lat, lon] of points) {
    const latE5 = Math.round(lat * 1e5);
    const lonE5 = Math.round(lon * 1e5);
    encodeValue(latE5 - prevLat, out);
    encodeValue(lonE5 - prevLon, out);
    prevLat = latE5;
    prevLon = lonE5;
  }
  return out.join('');
}

/** Inverse of {@link encodePolyline}; used by tests (the client has its own copy). */
export function decodePolyline(encoded: string): LatLon[] {
  const points: LatLon[] = [];
  let lat = 0;
  let lon = 0;
  let i = 0;
  const readValue = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(i) - 63;
      i += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < encoded.length) {
    lat += readValue();
    lon += readValue();
    points.push([lat / 1e5, lon / 1e5]);
  }
  return points;
}
