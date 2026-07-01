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

/** Pace directly from seconds/km — a single value, or a min–max range. */
export function formatPaceFromSecPerKm(
  secPerKm: number | null | undefined,
  maxSecPerKm?: number | null,
): string {
  if (secPerKm == null && maxSecPerKm == null) return '—';
  if (secPerKm != null && maxSecPerKm != null && maxSecPerKm !== secPerKm) {
    return `${mmssPerKm(secPerKm)}–${mmssPerKm(maxSecPerKm)} /km`;
  }
  return `${mmssPerKm((secPerKm ?? maxSecPerKm)!)} /km`;
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
