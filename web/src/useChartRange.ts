import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Granularity } from '@fitness/shared';
import { daysAgoIso } from './chartHelpers';

const LS_FROM = 'chart-range-from';
const LS_TO   = 'chart-range-to';
const LS_TYPE = 'chart-type';

function ls(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSave(key: string, value: string) {
  try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch {}
}

/**
 * Drop-in replacement for the repeated useSearchParams + setParam + from/to/granularity
 * pattern across chart pages. Defaults to 30d and persists the last chosen range to
 * localStorage so it survives navigation.
 */
export function useChartRange(defaultGranularity: Granularity = 'week', defaultType = '') {
  const [searchParams, setSearchParams] = useSearchParams();

  const from        = searchParams.get('from')        ?? ls(LS_FROM) ?? daysAgoIso(30);
  const to          = searchParams.get('to')          ?? ls(LS_TO)   ?? '';
  const granularity = (searchParams.get('granularity') as Granularity) ?? defaultGranularity;
  // Type persists across pages like the date range. An empty string is a real
  // choice ("all types"), so it is stored verbatim rather than cleared.
  const type        = searchParams.get('type')        ?? ls(LS_TYPE) ?? defaultType;

  const setParam = useCallback((key: string, value: string) => {
    if (key === 'from') lsSave(LS_FROM, value);
    if (key === 'to')   lsSave(LS_TO,   value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    });
  }, [setSearchParams]);

  const setType = useCallback((value: string) => {
    try { localStorage.setItem(LS_TYPE, value); } catch {}
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('type', value);
      return next;
    });
  }, [setSearchParams]);

  return { from, to, granularity, type, setParam, setType, setSearchParams, searchParams };
}
