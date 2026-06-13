// Garmin training-status phrases look like `PRODUCTIVE_2`, `STRAINED_4` or
// `MAINTAINING_AER_LOW_FOCUS`. We collapse them to a base category for the
// timeline. Ordered low → high training stress.
export const STATUS_ORDER = [
  'NO STATUS',
  'DETRAINING',
  'RECOVERY',
  'MAINTAINING',
  'PRODUCTIVE',
  'PEAKING',
  'OVERREACHING',
  'UNPRODUCTIVE',
  'STRAINED',
] as const;

export const STATUS_COLOR: Record<string, string> = {
  'NO STATUS': '#4a5260',
  DETRAINING: '#7f8c9b',
  RECOVERY: '#5fa8e6',
  MAINTAINING: '#5fce6e',
  PRODUCTIVE: '#2e9e4f',
  PEAKING: '#9b7fd4',
  OVERREACHING: '#e6b95f',
  UNPRODUCTIVE: '#e6915f',
  STRAINED: '#e66a5f',
};

export function baseStatus(phrase: string | null): string | null {
  if (!phrase) return null;
  if (phrase.startsWith('NO_STATUS')) return 'NO STATUS';
  return phrase.split('_')[0] ?? null;
}
