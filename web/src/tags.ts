import { useQuery } from '@tanstack/react-query';
import type { Tag } from '@fitness/shared';
import { fetchTags } from './api';

/** The tag list is small, shared by several pages, and rarely changes. */
export const TAGS_QUERY_KEY = ['tags'] as const;

export function useTags() {
  return useQuery({ queryKey: TAGS_QUERY_KEY, queryFn: fetchTags });
}

export function tagsById(tags: Tag[] | undefined): Map<number, Tag> {
  return new Map((tags ?? []).map((t) => [t.id, t]));
}
