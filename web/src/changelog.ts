/**
 * Parsing for CHANGELOG.md, which is baked into the bundle at build time
 * (`?raw`) so the release notes always describe the exact build showing them.
 */

export interface ChangelogEntry {
  /** The version string from the heading, e.g. `0.21.0`. */
  version: string;
  /** Whatever followed the dash in the heading, usually a date. Null if absent. */
  date: string | null;
  /** The entry's markdown body, with surrounding blank lines trimmed. */
  body: string;
}

// Release headings look like `## 0.21.0 — 2026-07-25`. The date is optional so
// an unreleased or hand-written heading still parses rather than vanishing.
const RELEASE_HEADING = /^##[ \t]+(.+?)[ \t]*$/gm;
const VERSION_AND_DATE = /^(\S+)(?:[ \t]*[—–-][ \t]*(.+))?$/;

/**
 * The most recent entry — the first `## ` section in the file. Returns null if
 * the changelog has no release headings at all, so a malformed or empty file
 * simply shows nothing instead of throwing during render.
 */
export function latestChangelogEntry(markdown: string): ChangelogEntry | null {
  RELEASE_HEADING.lastIndex = 0;
  const first = RELEASE_HEADING.exec(markdown);
  if (!first) return null;

  const bodyStart = first.index + first[0].length;
  const next = RELEASE_HEADING.exec(markdown);
  const body = markdown.slice(bodyStart, next ? next.index : undefined).trim();

  const parsed = VERSION_AND_DATE.exec(first[1]!.trim());
  return {
    version: parsed?.[1] ?? first[1]!.trim(),
    date: parsed?.[2]?.trim() ?? null,
    body,
  };
}
