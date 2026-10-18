'use client';

import { useState, useTransition } from 'react';
import { changeCategoryDeadline } from '@/app/actions';

interface CategoryDeadlineProps {
  topicId: number;
  /** YYYY-MM-DD or "" */
  value: string;
  /** Repo category: the deadline is set in topic.md and Sync overwrites it */
  fromRepo: boolean;
}

/**
 * Category deadline on its page. Until the date the cards repeat more often (1, 2, 4 days, never past the day before)
 * and come first in the queue with no new-card limit; after the date the category is ordinary.
 */
export function CategoryDeadline({ topicId, value, fromRepo }: CategoryDeadlineProps) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const save = (next: string): void => {
    setError('');
    startTransition(async () => {
      const ok = await changeCategoryDeadline(topicId, next);
      if (!ok) setError('Date must be YYYY-MM-DD');
    });
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 14 }} data-testid="category-deadline">
      <span className="faint">⏱ Deadline</span>
      <input
        type="date"
        value={draft}
        disabled={pending}
        onChange={(event) => {
          setDraft(event.target.value);
          save(event.target.value);
        }}
        style={{ fontSize: 14 }}
      />
      {draft && (
        <button type="button" className="btn sm" disabled={pending} onClick={() => { setDraft(''); save(''); }}>
          Clear
        </button>
      )}
      <span className="faint" style={{ fontSize: 13 }}>
        {draft
          ? 'Until this date the cards come first and repeat every 1, 2, 4… days, never past the day before. After it, normal schedule.'
          : 'Set a date (an interview, say) to review this category first and more often until then.'}
        {fromRepo && draft && ' Comes from topic.md in the repo: Sync overwrites what you set here.'}
      </span>
      {error && <span style={{ color: '#eb5757', fontSize: 13 }}>{error}</span>}
    </div>
  );
}
