import type { TagColor } from '@/lib/labels';

export function Tag({ color, children }: { color: TagColor; children: React.ReactNode }) {
  return <span className={`tag ${color}`}>{children}</span>;
}
