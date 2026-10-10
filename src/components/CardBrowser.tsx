'use client';

import Link from 'next/link';
import { Fragment, useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from 'react';
import { chooseCardCategory, finishCardSession, gradeCard, removeCard } from '@/app/actions';
import { CategoryPicker, type CategoryOption } from '@/components/CategoryPicker';
import { Markdown } from '@/components/Markdown';
import { categoryHref } from '@/lib/card-links';

export interface BrowseCard {
  id: number;
  question: string;
  answer: string;
  topicId: number | null;
  topicName: string;
  /** "new", "due", "in 3d" */
  dueLabel: string;
  lapses: number;
  /** картка прийшла з репо */
  fromRepo: boolean;
  /** картку з репо змінили в апці: Sync її більше не оновлює */
  editedInApp: boolean;
}

/** null у topicId = картки без категорії */
export interface LockedCategory {
  topicId: number | null;
}

interface CardBrowserProps {
  cards: BrowseCard[];
  /** усі категорії для вибору на картці, спершу нещодавні */
  categories: CategoryOption[];
  /** сторінка однієї категорії: фільтра категорій нема, картки вже тільки її */
  locked?: LockedCategory;
}

interface TopicOption {
  id: number | null;
  name: string;
  count: number;
}

/** фільтр "усі категорії"; окреме значення, бо null уже означає "без категорії" */
const ALL = 'all';

const ROW_STYLE: CSSProperties = { padding: '10px 8px', borderBottom: '1px solid var(--border)' };
const DUE_STYLE: CSSProperties = { width: 78, textAlign: 'right', fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 };

function topicKey(topicId: number | null): string {
  return topicId === null ? 'none' : String(topicId);
}

/**
 * Картки без розкладу, згруповані по категоріях: пошук, показати відповіді, пройти вибрані підряд.
 * Клік по картці відкриває її сторінку (правка), клік по категорії картки, доданої руками, міняє категорію.
 */
export function CardBrowser({ cards, categories, locked }: CardBrowserProps) {
  const [filter, setFilter] = useState<string>(ALL);
  const [search, setSearch] = useState('');
  const [showAnswers, setShowAnswers] = useState(false);
  const [onlyForgotten, setOnlyForgotten] = useState(false);
  const [practice, setPractice] = useState<BrowseCard[] | null>(null);
  const [, startTransition] = useTransition();

  const remove = (card: BrowseCard): void => {
    const title = card.question.length > 80 ? `${card.question.slice(0, 80)}…` : card.question;
    const note = card.fromRepo ? '\n\nIt comes from the repo: Sync will not bring it back.' : '';
    if (!window.confirm(`Delete this card?\n\n${title}${note}`)) return;
    startTransition(() => removeCard(card.id));
  };

  const topics = useMemo<TopicOption[]>(() => {
    const byTopic = new Map<string, TopicOption>();
    for (const card of cards) {
      const key = topicKey(card.topicId);
      const existing = byTopic.get(key);
      if (existing) existing.count += 1;
      else byTopic.set(key, { id: card.topicId, name: card.topicName, count: 1 });
    }
    return [...byTopic.values()];
  }, [cards]);

  const filtered = useMemo<BrowseCard[]>(() => {
    const needle = search.trim().toLowerCase();
    return cards.filter((card) => {
      if (filter !== ALL && topicKey(card.topicId) !== filter) return false;
      if (onlyForgotten && card.lapses === 0) return false;
      if (!needle) return true;
      return card.question.toLowerCase().includes(needle) || card.answer.toLowerCase().includes(needle);
    });
  }, [cards, filter, search, onlyForgotten]);

  if (practice) {
    return <CardPractice cards={practice} onExit={() => setPractice(null)} />;
  }

  const shuffle = (list: BrowseCard[]): BrowseCard[] => {
    const copy = [...list];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const other = Math.floor(Math.random() * (index + 1));
      const a = copy[index];
      const b = copy[other];
      if (a !== undefined && b !== undefined) {
        copy[index] = b;
        copy[other] = a;
      }
    }
    return copy;
  };

  const shownCounts = new Map<string, number>();
  for (const card of filtered) shownCounts.set(topicKey(card.topicId), (shownCounts.get(topicKey(card.topicId)) ?? 0) + 1);
  const newCardHref = locked
    ? `/cards/new?topic=${topicKey(locked.topicId)}`
    : filter === ALL ? '/cards/new' : `/cards/new?topic=${filter}`;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        {!locked && (
          <select className="input" style={{ width: 'auto', maxWidth: 320 }} value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value={ALL}>All categories ({cards.length})</option>
            {topics.map((topic) => (
              <option key={topicKey(topic.id)} value={topicKey(topic.id)}>{topic.name} ({topic.count})</option>
            ))}
          </select>
        )}
        <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="Search questions and answers" value={search}
          onChange={(event) => setSearch(event.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, fontSize: 14 }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={showAnswers} onChange={(event) => setShowAnswers(event.target.checked)} /> Show answers
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyForgotten} onChange={(event) => setOnlyForgotten(event.target.checked)} /> Only ever forgotten
        </label>
        <span style={{ flex: 1 }} />
        <Link className="btn" data-testid="new-card-button" href={newCardHref}>+ New card</Link>
        <button className="btn" disabled={filtered.length === 0} onClick={() => setPractice(filtered)}>Go through {filtered.length}</button>
        <button className="btn" disabled={filtered.length === 0} onClick={() => setPractice(shuffle(filtered))}>Shuffled</button>
      </div>

      {filtered.length === 0 && <p className="faint">No cards match.</p>}
      {filtered.map((card, index) => {
        const previous = filtered[index - 1];
        const startsGroup = !locked && (previous === undefined || previous.topicId !== card.topicId);
        return (
          <Fragment key={card.id}>
            {startsGroup && (
              <div className="card-group" data-testid={`card-group-${topicKey(card.topicId)}`}>
                <Link href={categoryHref(card.topicId)}>{card.topicName}</Link>
                <span className="faint">{shownCounts.get(topicKey(card.topicId)) ?? 0}</span>
              </div>
            )}
            <div className="row-hover" style={ROW_STYLE} data-testid={`card-row-${card.id}`}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                <Link href={`/cards/${card.id}`} className="card-question" title="Open the card">{card.question}</Link>
                {card.editedInApp && <span className="tag orange" title="Changed in the app: Sync no longer updates this card from the repo">edited</span>}
                {card.lapses > 0 && <span className="tag red" title="Times forgotten">×{card.lapses}</span>}
                {!card.fromRepo && (
                  <CategoryPicker
                    value={card.topicId}
                    categories={categories}
                    testId={`card-category-${card.id}`}
                    onChoose={(topicId) => startTransition(async () => { await chooseCardCategory(card.id, topicId); })}
                  />
                )}
                <span className={`mono ${card.dueLabel === 'due' ? 'cat-due' : 'faint'}`} style={DUE_STYLE}>
                  {card.dueLabel}
                </span>
                <button type="button" className="btn sm ghost" title="Delete" aria-label="Delete card" data-testid={`card-delete-${card.id}`}
                  onClick={() => remove(card)}>✕</button>
              </div>
              {showAnswers && (
                <div style={{ marginTop: 6, fontSize: 14 }}>
                  {card.answer ? <Markdown>{card.answer}</Markdown> : <span className="faint">No answer yet.</span>}
                </div>
              )}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

/** Вільний прохід: Space = відповідь, → = далі, F = забув (картка стане в розклад на завтра). */
function CardPractice({ cards, onExit }: { cards: BrowseCard[]; onExit: () => void }) {
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [forgotten, setForgotten] = useState(0);
  const shownAt = useRef<number>(Date.now());
  const [, startTransition] = useTransition();
  const card = cards[position];

  useEffect(() => {
    shownAt.current = Date.now();
  }, [position]);

  useEffect(() => {
    if (card === undefined) startTransition(() => finishCardSession());
  }, [card]);

  const next = (forgot: boolean): void => {
    if (!card) return;
    const seconds = (Date.now() - shownAt.current) / 1000;
    startTransition(async () => {
      await gradeCard({ questionId: card.id, grade: forgot ? 'FORGOT' : 'PRACTICE', seconds });
    });
    if (forgot) setForgotten((count) => count + 1);
    setRevealed(false);
    setPosition((current) => current + 1);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.code === 'Space') {
        event.preventDefault();
        if (!revealed) setRevealed(true);
        else next(false);
      } else if (revealed && (event.key === 'ArrowRight' || event.key === 'Enter')) {
        next(false);
      } else if (revealed && (event.key === 'f' || event.key === 'F' || event.key === 'а' || event.key === 'А')) {
        next(true);
      } else if (event.key === 'Escape') {
        onExit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!card) {
    return (
      <div className="callout">
        <div>
          <b>Went through {cards.length}.</b> {forgotten > 0 ? `${forgotten} marked as forgotten, they are due tomorrow.` : 'Nothing forgotten.'}
          <div style={{ marginTop: 8 }}><button className="btn sm" onClick={onExit}>← Back to all cards</button></div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="review-meta muted">
        <span>{card.topicName} · free run, schedule unchanged</span>
        <span className="mono">{position + 1} / {cards.length} · <button className="btn sm ghost" onClick={onExit}>Exit <span className="kbd">Esc</span></button></span>
      </div>
      <div className="progress review-progress">
        <div style={{ width: `${(position / cards.length) * 100}%` }} />
      </div>
      <div className="flashcard">
        <div className="q">{card.question}</div>
        {revealed && (
          <div className="a">{card.answer ? <Markdown>{card.answer}</Markdown> : <p className="faint">No answer yet.</p>}</div>
        )}
      </div>
      {!revealed ? (
        <div className="grade-row">
          <button className="btn primary" onClick={() => setRevealed(true)}>Show answer <span className="kbd">Space</span></button>
        </div>
      ) : (
        <div className="grade-row">
          <button className="btn primary" onClick={() => next(false)}>Next <span className="kbd">→</span></button>
          <button className="btn grade forgot" onClick={() => next(true)}><span className="kbd">F</span> <span className="grade-label">Forgot</span> <span className="faint" style={{ fontSize: 12 }}>due tomorrow</span></button>
        </div>
      )}
    </div>
  );
}
