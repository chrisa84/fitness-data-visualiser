// Maps the current route + URL params to a short hint for the AI, so a floating
// chat can answer "what am I looking at?" without any per-page wiring.

const PAGE_LABELS: Record<string, string> = {
  '/': 'Dashboard (health & recovery overview)',
  '/activities': 'Activities list',
  '/volume': 'Activity volume',
  '/performance': 'Performance & training',
  '/intensity': 'HR-zone intensity',
  '/dynamics': 'Running dynamics',
  '/analysis': 'Cross-metric analysis',
  '/records': 'Personal records',
  '/events': 'Life events',
  '/chat': 'Chat',
};

/** A human description of the screen and its active filters, or undefined. */
export function describeLocation(pathname: string, search: string): string | undefined {
  let label = PAGE_LABELS[pathname];
  if (!label && pathname.startsWith('/activities/')) label = 'Activity detail';
  if (!label) return undefined;

  const params = new URLSearchParams(search);
  const bits: string[] = [];
  const from = params.get('from');
  const to = params.get('to');
  if (from || to) bits.push(`date range ${from || 'start'} to ${to || 'today'}`);
  const granularity = params.get('granularity');
  if (granularity) bits.push(`per ${granularity}`);
  const type = params.get('type');
  if (type) bits.push(`activity type ${type}`);
  const keys = params.get('keys');
  if (keys) bits.push(`metrics ${keys}`);
  const metric = params.get('metric');
  if (metric) bits.push(`metric ${metric}`);

  return bits.length ? `${label} — ${bits.join(', ')}` : label;
}
