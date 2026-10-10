'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { finishCardSession, gradeCard } from '@/app/actions';
import { Markdown } from '@/components/Markdown';
import type { CardGrade } from '@/generated/prisma/enums';

export interface ReviewCard {
  id: number;
  question: string;
  answer: string;
  topicName: string;
  isNew: boolean;
}

interface QueueEntry {
  card: ReviewCard;
  /** картку забув і бачиш удруге в цій сесії: розклад уже виставлений, тут просто закріпити */
  relearn: boolean;
}

interface Tally {
  forgot: number;
  hard: number;
  good: number;
}

const GRADES: { grade: CardGrade; key: string; label: string; tone: string; hint: string }[] = [
  { grade: 'FORGOT', key: '1', label: 'Забув', tone: 'forgot', hint: 'знову завтра' },
  { grade: 'HARD', key: '2', label: 'Важко', tone: 'hard', hint: 'той самий інтервал' },
  { grade: 'GOOD', key: '3', label: 'Згадав', tone: 'good', hint: 'наступний інтервал' },
];

/** Сесія повторення: Space = показати відповідь, 1/2/3 = оцінка. "Забув" повертає картку в кінець сесії. */
export function CardReviewSession({ cards }: { cards: ReviewCard[] }) {
  const [queue, setQueue] = useState<QueueEntry[]>(() => cards.map((card) => ({ card, relearn: false })));
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [tally, setTally] = useState<Tally>({ forgot: 0, hard: 0, good: 0 });
  const shownAt = useRef<number>(Date.now());
  const [, startTransition] = useTransition();

  const entry = queue[position];
  const finished = entry === undefined;

  useEffect(() => {
    shownAt.current = Date.now();
  }, [position]);

  useEffect(() => {
    if (finished && queue.length > 0) startTransition(() => finishCardSession());
  }, [finished, queue.length]);

  const grade = useCallback(
    (value: CardGrade) => {
      if (!entry || !revealed) return;
      const seconds = (Date.now() - shownAt.current) / 1000;
      // повторний показ після "Забув" розклад не міняє: картка вже стоїть на завтра
      const sent: CardGrade = entry.relearn ? 'PRACTICE' : value;
      startTransition(async () => {
        await gradeCard({ questionId: entry.card.id, grade: sent, seconds });
      });
      if (!entry.relearn) {
        setTally((current) => ({
          forgot: current.forgot + (value === 'FORGOT' ? 1 : 0),
          hard: current.hard + (value === 'HARD' ? 1 : 0),
          good: current.good + (value === 'GOOD' ? 1 : 0),
        }));
      }
      if (value === 'FORGOT' && !entry.relearn) {
        setQueue((current) => [...current, { card: entry.card, relearn: true }]);
      }
      setRevealed(false);
      setPosition((current) => current + 1);
    },
    [entry, revealed],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
      if (event.code === 'Space') {
        event.preventDefault();
        if (!revealed) setRevealed(true);
        else if (entry?.relearn) grade('GOOD');
        return;
      }
      if (!revealed || entry?.relearn) return;
      const match = GRADES.find((option) => option.key === event.key);
      if (match) grade(match.grade);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealed, entry, grade]);

  if (cards.length === 0) {
    return (
      <div className="callout">
        <div>На сьогодні порожньо. Усі картки в <Link href="/cards?tab=all" style={{ textDecoration: 'underline' }}>All cards</Link>.</div>
      </div>
    );
  }

  if (finished) {
    return (
      <div className="callout">
        <div>
          <b>На сьогодні все.</b> Згадав {tally.good} · важко {tally.hard} · забув {tally.forgot}.
          <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>
            Забуті повернуться завтра. Хочеш ще: будь-що з{' '}
            <Link href="/cards?tab=all" style={{ textDecoration: 'underline' }}>All cards</Link>.
          </div>
        </div>
      </div>
    );
  }

  const done = Math.min(position, queue.length);
  return (
    <div>
      <div className="review-meta muted">
        <span>{entry.card.topicName}{entry.card.isNew && !entry.relearn ? ' · нова' : ''}{entry.relearn ? ' · ще раз' : ''}</span>
        <span className="mono">{done + 1} / {queue.length}</span>
      </div>
      <div className="progress review-progress">
        <div style={{ width: `${(done / queue.length) * 100}%` }} />
      </div>

      <div className="flashcard">
        <div className="q">{entry.card.question}</div>
        {revealed && (
          <div className="a">
            {entry.card.answer ? <Markdown>{entry.card.answer}</Markdown> : <p className="faint">У цієї картки ще нема відповіді.</p>}
          </div>
        )}
      </div>

      {!revealed ? (
        <div className="grade-row">
          <button className="btn primary" onClick={() => setRevealed(true)}>Показати відповідь <span className="kbd">Space</span></button>
          <span className="faint" style={{ fontSize: 13, alignSelf: 'center' }}>Спершу відповідай у голові або вголос.</span>
        </div>
      ) : entry.relearn ? (
        <div className="grade-row">
          <button className="btn primary" onClick={() => grade('GOOD')}>Зрозуміло <span className="kbd">Space</span></button>
          <span className="faint" style={{ fontSize: 13, alignSelf: 'center' }}>Уже стоїть на завтра.</span>
        </div>
      ) : (
        <div className="grade-row">
          {GRADES.map((option) => (
            <button key={option.grade} className={`btn grade ${option.tone}`} onClick={() => grade(option.grade)}>
              <span className="kbd">{option.key}</span>
              <span className="grade-label">{option.label}</span>
              <span className="faint" style={{ fontSize: 12 }}>{option.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
