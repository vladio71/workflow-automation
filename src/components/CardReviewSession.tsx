'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { finishCardSession, gradeCard } from '@/app/actions';
import { CardMarkdown } from '@/components/Glossary';
import type { CardGrade } from '@/generated/prisma/enums';

export interface ReviewCard {
  id: number;
  question: string;
  answer: string;
  topicId: number | null;
  topicName: string;
  isNew: boolean;
}

interface QueueEntry {
  card: ReviewCard;
  /** A forgotten card seen a second time in this session: the schedule is already set, this pass only reinforces */
  relearn: boolean;
}

interface Tally {
  forgot: number;
  hard: number;
  good: number;
}

const GRADES: { grade: CardGrade; key: string; label: string; tag: string; hint: string }[] = [
  { grade: 'FORGOT', key: '1', label: 'Forgot', tag: 'red', hint: 'again tomorrow' },
  { grade: 'HARD', key: '2', label: 'Hard', tag: 'orange', hint: 'same interval' },
  { grade: 'GOOD', key: '3', label: 'Remembered', tag: 'green', hint: 'next interval' },
];

/** Review session: Space = show the answer, 1/2/3 = grade. "Forgot" puts the card back at the end of the session. */
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
      // the second showing after "Forgot" does not change the schedule: the card is already set for tomorrow
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
        <span className="emoji">✅</span>
        <div>Nothing due right now. Browse everything in <Link href="/cards?tab=all" style={{ textDecoration: 'underline' }}>All cards</Link>.</div>
      </div>
    );
  }

  if (finished) {
    return (
      <div className="callout">
        <span className="emoji">🎉</span>
        <div>
          <b>Done for today.</b> Remembered {tally.good} · hard {tally.hard} · forgot {tally.forgot}.
          <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>
            Forgotten ones come back tomorrow. Want more? Go through anything in{' '}
            <Link href="/cards?tab=all" style={{ textDecoration: 'underline' }}>All cards</Link>.
          </div>
        </div>
      </div>
    );
  }

  const done = Math.min(position, queue.length);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }} className="muted">
        <span>{entry.card.topicName}{entry.card.isNew && !entry.relearn ? ' · new' : ''}{entry.relearn ? ' · once more' : ''}</span>
        <span>{done + 1} / {queue.length}</span>
      </div>
      <div className="progress" style={{ marginBottom: 12 }}>
        <div style={{ width: `${(done / queue.length) * 100}%` }} />
      </div>

      <div className="flashcard">
        <div className="q">{entry.card.question}</div>
        {revealed && (
          <div className="a">
            {entry.card.answer ? <CardMarkdown topicId={entry.card.topicId}>{entry.card.answer}</CardMarkdown> : <p className="faint">No answer yet for this card.</p>}
          </div>
        )}
      </div>

      {!revealed ? (
        <div className="grade-row">
          <button className="btn primary" onClick={() => setRevealed(true)}>Show answer <span className="kbd">Space</span></button>
          <span className="faint" style={{ fontSize: 13, alignSelf: 'center' }}>Answer in your head first (or out loud).</span>
        </div>
      ) : entry.relearn ? (
        <div className="grade-row">
          <button className="btn primary" onClick={() => grade('GOOD')}>Got it <span className="kbd">Space</span></button>
          <span className="faint" style={{ fontSize: 13, alignSelf: 'center' }}>Already scheduled for tomorrow.</span>
        </div>
      ) : (
        <div className="grade-row">
          {GRADES.map((option) => (
            <button key={option.grade} className="btn" onClick={() => grade(option.grade)}>
              <span className="kbd">{option.key}</span>
              <span className={`tag ${option.tag}`}>{option.label}</span>
              <span className="faint" style={{ fontSize: 12 }}>{option.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
