import Link from 'next/link';
import type { CardCategory } from '@/lib/cards';
import { categoryHref, categoryParam, categoryReviewHref } from '@/lib/card-links';
import { relativeDay } from '@/lib/schedule';

interface CategoryTableProps {
  categories: CardCategory[];
  /** скільки нових карток ще можна взяти сьогодні (ліміт спільний на всі категорії) */
  newLeft: number;
  now: Date;
}

/** Категорії карток таблицею: скільки карток, скільки чекає сьогодні, коли наступний термін. */
export function CategoryTable({ categories, newLeft, now }: CategoryTableProps) {
  return (
    <div className="cat-list" data-testid="category-table">
      {categories.map((category) => {
        const waiting = category.due + Math.min(category.fresh, newLeft);
        const overdue = category.due > 0;
        return (
          <div key={categoryParam(category.id)} className={`cat-row${overdue ? ' due' : ''}`} data-testid={`category-row-${categoryParam(category.id)}`}>
            <Link href={categoryHref(category.id)} className="cat-name">{category.name}</Link>
            <span className="cat-meta mono">
              <span title="усього карток">{category.total}</span>
              {category.due > 0 && <span className="cat-due" title="термін настав">{category.due} due</span>}
              {category.fresh > 0 && <span className="muted" title="нових">{category.fresh} new</span>}
              <span className={overdue ? 'cat-due' : 'faint'}>{relativeDay(category.nextDueAt, now)}</span>
            </span>
            {waiting > 0 ? (
              <Link className="btn sm" href={categoryReviewHref(category.id)}>Recall {waiting}</Link>
            ) : (
              <span className="faint" style={{ fontSize: 12 }}>все повторено</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
