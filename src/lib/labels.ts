import type { Confidence, CycleStatus, Track } from '@/generated/prisma/enums';

/** Кольори як у Notion select. Ключ = назва кольору з globals.css (--tag-<color>-bg / -fg). */
export type TagColor = 'gray' | 'red' | 'yellow' | 'green' | 'blue' | 'purple' | 'orange' | 'pink' | 'brown';

export interface Option<T extends string> {
  value: T;
  label: string;
  color: TagColor;
}

export const TRACKS: readonly Option<Track>[] = [
  { value: 'GRAPHQL', label: 'GraphQL', color: 'pink' },
  { value: 'SYSTEM_DESIGN', label: 'System design', color: 'blue' },
  { value: 'NODE', label: 'Node', color: 'green' },
  { value: 'AI', label: 'AI', color: 'purple' },
  { value: 'PYTHON', label: 'Python', color: 'yellow' },
];

export const CONFIDENCES: readonly Option<Confidence>[] = [
  { value: 'NOT_STARTED', label: 'Not started', color: 'gray' },
  { value: 'RED', label: 'Red', color: 'red' },
  { value: 'AMBER', label: 'Amber', color: 'orange' },
  { value: 'GREEN', label: 'Green', color: 'green' },
];

export const CYCLE_STATUSES: readonly Option<CycleStatus>[] = [
  { value: 'PLANNED', label: 'Planned', color: 'gray' },
  { value: 'ACTIVE', label: 'Active', color: 'blue' },
  { value: 'DONE', label: 'Done', color: 'green' },
];

export function optionFor<T extends string>(options: readonly Option<T>[], value: T): Option<T> {
  const found = options.find((option) => option.value === value);
  if (!found) throw new Error(`Unknown option ${value}`);
  return found;
}
