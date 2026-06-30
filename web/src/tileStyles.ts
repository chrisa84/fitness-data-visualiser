// Build-time key for local dev (VITE_STADIA_API_KEY in .env.local).
// In production the server exposes STADIA_API_KEY via /api/config; see useConfig.ts.
const BUILD_TIME_KEY = (import.meta.env.VITE_STADIA_API_KEY as string | undefined) ?? '';

export type TileStyle = 'outdoors' | 'liberty' | 'fiord';

export function tileStyleUrl(style: TileStyle, stadiaKey = BUILD_TIME_KEY): string {
  const key = stadiaKey || BUILD_TIME_KEY;
  switch (style) {
    case 'outdoors':
      return `https://tiles.stadiamaps.com/styles/outdoors.json${key ? `?api_key=${key}` : ''}`;
    case 'liberty':
      return 'https://tiles.openfreemap.org/styles/liberty';
    case 'fiord':
      return 'https://tiles.openfreemap.org/styles/fiord';
  }
}

export function defaultTileStyle(stadiaKey = BUILD_TIME_KEY): TileStyle {
  return stadiaKey || BUILD_TIME_KEY ? 'outdoors' : 'liberty';
}

export const TILE_STYLE_LABELS: Record<TileStyle, string> = {
  outdoors: 'Outdoors',
  liberty:  'Standard',
  fiord:    'Dark',
};

export const TILE_STYLES: TileStyle[] = ['outdoors', 'liberty', 'fiord'];
