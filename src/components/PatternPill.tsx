import Link from 'next/link';
import { getPattern } from '@/lib/content';

/** Мітка патерну мислення (P7 Читання чи запис?) з посиланням на його картку. */
export function PatternPill({ id }: { id: string }) {
  const pattern = getPattern(id);
  return (
    <Link href={`/patterns#${id}`} className="pill" title={pattern?.q ?? ''}>
      {id}{pattern ? ` ${pattern.name}` : ''}
    </Link>
  );
}
