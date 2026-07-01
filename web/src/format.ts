export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function formatKm(metres: number | null | undefined, decimals = 2): string {
  if (metres == null) return '—';
  return `${(metres / 1000).toFixed(decimals)} km`;
}

/** Pace in min/km from speed in m/s. */
export function formatPace(speedMps: number | null | undefined): string {
  if (speedMps == null || speedMps <= 0) return '—';
  const secPerKm = 1000 / speedMps;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')} /km`;
}

function mmssPerKm(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Pace directly from seconds/km — a single value, or a min–max range.
 * Always renders faster→slower regardless of which argument order the
 * values arrive in (fewer seconds/km = faster), so a mislabeled min/max
 * still displays a sane range instead of e.g. "5:30–5:00/km".
 */
export function formatPaceFromSecPerKm(
  secPerKm: number | null | undefined,
  maxSecPerKm?: number | null,
): string {
  const values = [secPerKm, maxSecPerKm].filter((v): v is number => v != null);
  if (values.length === 0) return '—';
  const fastest = Math.min(...values);
  const slowest = Math.max(...values);
  if (fastest === slowest) return `${mmssPerKm(fastest)} /km`;
  return `${mmssPerKm(fastest)}–${mmssPerKm(slowest)} /km`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').slice(0, 16);
}

export function formatNumber(n: number | null | undefined, suffix = '', decimals = 0): string {
  if (n == null) return '—';
  return `${n.toFixed(decimals)}${suffix}`;
}

/** snake_case Garmin activity type → friendly label. */
export function formatType(type: string | null | undefined): string {
  if (!type) return '—';
  return type.replace(/_v\d+$/, '').replace(/_/g, ' ');
}
