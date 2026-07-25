import { apiFetch } from '../../api';
import { haversineM, type LngLat } from './plannerGeo';

/**
 * The planner's outside world: OSRM for path snapping, Nominatim for place
 * search, and opentopodata for elevation (proxied through our own server, which
 * is the only one of the three that needs it — the other two send CORS headers).
 *
 * Every call here fails soft. A dead routing service should degrade the planner
 * to straight lines, not break the page.
 */

const OSRM = 'https://router.project-osrm.org/route/v1/foot';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const ELEVATION = '/api/elevation';

export interface SearchResult {
  placeId: number;
  displayName: string;
  lat: number;
  lon: number;
}

/** Path-snapped route between two points; falls back to a straight line. */
export async function osrmRoute(a: LngLat, b: LngLat): Promise<{ coords: LngLat[]; distanceM: number }> {
  try {
    const res = await fetch(`${OSRM}/${a[0]},${a[1]};${b[0]},${b[1]}?overview=full&geometries=geojson`);
    if (res.ok) {
      const route = (await res.json()).routes?.[0];
      if (route) {
        return { coords: route.geometry.coordinates as LngLat[], distanceM: route.distance };
      }
    }
  } catch {
    // fall through to the straight line
  }
  return { coords: [a, b], distanceM: haversineM(a, b) };
}

export async function nominatimSearch(q: string): Promise<SearchResult[]> {
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
  } catch {
    return [];
  }
}

/** Elevations for each coordinate, or 'error' so the caller can say so. */
export async function fetchElevations(coords: LngLat[]): Promise<number[] | 'error'> {
  // opentopodata expects lat,lng order — the reverse of our LngLat.
  const locations = coords.map(([lng, lat]) => `${lat.toFixed(6)},${lng.toFixed(6)}`).join('|');
  try {
    const res = await apiFetch(`${ELEVATION}?locations=${locations}`);
    if (!res.ok) {
      console.error('opentopodata HTTP error', res.status, await res.text().catch(() => ''));
      return 'error';
    }
    const json = await res.json();
    if (json.status !== 'OK') {
      console.error('opentopodata non-OK status', json);
      return 'error';
    }
    return (json.results as { elevation: number }[]).map((r) => r.elevation ?? 0);
  } catch (e) {
    console.error('opentopodata fetch failed', e);
    return 'error';
  }
}
