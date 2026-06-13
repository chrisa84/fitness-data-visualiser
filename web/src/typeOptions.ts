import type { ActivityTypeCount } from '@fitness/shared';
import { ACTIVITY_GROUPS, GROUP_PREFIX, activityGroupOptionValue } from '@fitness/shared';
import { formatType } from './format';

export interface TypeOption {
  value: string;
  label: string;
}

/**
 * Builds the activity-type filter options: each group whose members are present
 * (with a summed count), followed by every raw type. Shared by the Activities
 * and Volume filter dropdowns so they always offer the same choices.
 */
export function buildTypeOptions(types: ActivityTypeCount[] | undefined): TypeOption[] {
  if (!types) return [];
  const countByType = new Map(types.map((t) => [t.type, t.count]));

  const groupOptions: TypeOption[] = ACTIVITY_GROUPS.flatMap((group) => {
    const total = group.types.reduce((sum, t) => sum + (countByType.get(t) ?? 0), 0);
    if (total === 0) return [];
    return [{ value: activityGroupOptionValue(group.key), label: `${group.label} (${total})` }];
  });

  const rawOptions: TypeOption[] = types.map((t) => ({
    value: t.type,
    label: `${formatType(t.type)} (${t.count})`,
  }));

  return [...groupOptions, ...rawOptions];
}

/** Human label for a filter value that may be a raw type or a `group:` key. */
export function labelForTypeValue(value: string): string {
  if (value.startsWith(GROUP_PREFIX)) {
    const key = value.slice(GROUP_PREFIX.length);
    return ACTIVITY_GROUPS.find((g) => g.key === key)?.label ?? formatType(value);
  }
  return formatType(value);
}
