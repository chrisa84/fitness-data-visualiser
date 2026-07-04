/**
 * Today as YYYY-MM-DD in the server's local timezone.
 *
 * Never use `new Date().toISOString().slice(0, 10)` for "today": that is the
 * UTC day, which is off by one near midnight for non-UTC users, while every
 * repository buckets by `start_time_local`. In deployment, set the `TZ`
 * environment variable to the users' timezone (e.g. `Europe/London`) so this
 * matches the days Garmin records.
 */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
