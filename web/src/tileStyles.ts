const STADIA_KEY = (import.meta.env.VITE_STADIA_API_KEY as string | undefined) || '';

export type TileStyle = 'outdoors' | 'liberty' | 'fiord';

export const TILE_STYLE_URLS: Record<TileStyle, string> = {
  outdoors: `https://tiles.stadiamaps.com/styles/outdoors.json${STADIA_KEY ? `?api_key=${STADIA_KEY}` : ''}`,
  liberty:  'https://tiles.openfreemap.org/styles/liberty',
  fiord:    'https://tiles.openfreemap.org/styles/fiord',
};

export const TILE_STYLE_LABELS: Record<TileStyle, string> = {
  outdoors: 'Outdoors',
  liberty:  'Standard',
  fiord:    'Dark',
};

// Outdoors is default when a Stadia key is configured; otherwise fall back to Liberty.
export const DEFAULT_TILE_STYLE: TileStyle = STADIA_KEY ? 'outdoors' : 'liberty';

export const TILE_STYLES: TileStyle[] = ['outdoors', 'liberty', 'fiord'];
