import Link from 'next/link';
import { deadlineLabel, type CardCategory } from '@/lib/cards';
import { categoryHref, categoryParam, categoryReviewHref } from '@/lib/card-links';
import { relativeDay } from '@/lib/schedule';

interface CategoryTableProps {
  categories: CardCategory[];
  /** How many new cards can still be taken today (the limit is shared across all categories) */
  newLeft: number;
  now: Date;
}

/** Card categories as a table: card count, how many are due today, next due date. */
export function CategoryTable({ categories, newLeft, now }: CategoryTableProps) {
  return (
    <table className="db" data-testid="category-table">
      <thead>
        <tr>
          <th><span className="ico">Aa</span>Category</th>
          <th><span className="ico">#</span>Cards</th>
          <th><span className="ico">#</span>Due</th>
          <th><span className="ico">#</span>New</th>
          <th><span className="ico">🗓</span>Next due</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {categories.map((category) => {
          // a category with a deadline takes all its new cards at once, the daily limit does not apply to it
          const waiting = category.due + (category.deadline ? category.fresh : Math.min(category.fresh, newLeft));
          const overdue = category.due > 0;
          return (
            <tr key={categoryParam(category.id)} data-testid={`category-row-${categoryParam(category.id)}`}>
              <td className="title-cell">
                <Link href={categoryHref(category.id)}>{category.name}</Link>
                {category.deadline && (
                  <span className="deadline-badge" title="Deadline: cards are reviewed more often and come first">
                    ⏱ {deadlineLabel(category.deadline, now)}
                  </span>
                )}
              </td>
              <td className="muted" style={{ width: 70 }}>{category.total}</td>
              <td style={{ width: 70, color: overdue ? '#eb5757' : undefined }} className={overdue ? '' : 'faint'}>{category.due || ''}</td>
              <td className="muted" style={{ width: 70 }}>{category.fresh || ''}</td>
              <td style={{ width: 110, color: overdue ? '#eb5757' : undefined }} className={overdue ? '' : 'muted'}>
                {relativeDay(category.nextDueAt, now)}
              </td>
              <td style={{ width: 110 }}>
                {waiting > 0 && <Link className="btn sm" href={categoryReviewHref(category.id)}>Recall {waiting} →</Link>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
