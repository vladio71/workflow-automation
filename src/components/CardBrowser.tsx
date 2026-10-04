'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from 'react';
import { finishCardSession, gradeCard, removeCard } from '@/app/actions';
import { EditCardForm, NewCardForm, type TopicChoice } from '@/components/CardForms';
import { Markdown } from '@/components/Markdown';

export interface BrowseCard {
  id: number;
  question: string;
  answer: string;
  topicId: number | null;
  topicName: string;
  /** "new", "today", "in 3d" */
  dueLabel: string;
  lapses: number;
  /** картка прийшла з репо */
  fromRepo: boolean;
  /** картку з репо змінили в апці: Sync її більше не оновлює */
  editedInApp: boolean;
}

interface CardBrowserProps {
  cards: BrowseCard[];
  initialTopicId: number | null;
  /** усі теми, для вибору в New card (у фільтрі тільки ті, де вже є картки) */
  topics: TopicChoice[];
}

interface TopicOption {
  id: number | null;
  name: string;
  count: number;
}

const ROW_STYLE: CSSProperties = { padding: '8px 6px', borderBottom: '1px solid var(--border)', borderRadius: 4 };

/** Усі картки без розкладу: фільтр, пошук, показати відповіді, пройти вибрані підряд; додати, змінити, видалити. */
export function CardBrowser({ cards, initialTopicId, topics: allTopics }: CardBrowserProps) {
  const [topicId, setTopicId] = useState<number | null>(initialTopicId);
  const [search, setSearch] = useState('');
  const [showAnswers, setShowAnswers] = useState(false);
  const [onlyForgotten, setOnlyForgotten] = useState(false);
  const [practice, setPractice] = useState<BrowseCard[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
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
      const key = String(card.topicId);
      const existing = byTopic.get(key);
      if (existing) existing.count += 1;
      else byTopic.set(key, { id: card.topicId, name: card.topicName, count: 1 });
    }
    return [...byTopic.values()];
  }, [cards]);

  const filtered = useMemo<BrowseCard[]>(() => {
    const needle = search.trim().toLowerCase();
    return cards.filter((card) => {
      if (topicId !== null && card.topicId !== topicId) return false;
      if (onlyForgotten && card.lapses === 0) return false;
      if (!needle) return true;
      return card.question.toLowerCase().includes(needle) || card.answer.toLowerCase().includes(needle);
    });
  }, [cards, topicId, search, onlyForgotten]);

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

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <select className="input" style={{ width: 'auto', maxWidth: 320 }} value={topicId === null ? '' : String(topicId)}
          onChange={(event) => setTopicId(event.target.value ? Number(event.target.value) : null)}>
          <option value="">All topics ({cards.length})</option>
          {topics.map((topic) => (
            <option key={String(topic.id)} value={topic.id === null ? '' : String(topic.id)}>{topic.name} ({topic.count})</option>
          ))}
        </select>
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
        <button className="btn" data-testid="new-card-button" disabled={adding} onClick={() => setAdding(true)}>+ New card</button>
        <button className="btn" disabled={filtered.length === 0} onClick={() => setPractice(filtered)}>▶ Go through {filtered.length}</button>
        <button className="btn" disabled={filtered.length === 0} onClick={() => setPractice(shuffle(filtered))}>🔀 Shuffled</button>
      </div>

      {adding && <NewCardForm topics={allTopics} defaultTopicId={topicId} onClose={() => setAdding(false)} />}

      {filtered.length === 0 && <p className="faint">No cards match.</p>}
      {filtered.map((card) =>
        editingId === card.id ? (
          <div key={card.id} style={{ ...ROW_STYLE, padding: '10px 6px 12px' }}>
            <EditCardForm card={card} onDone={() => setEditingId(null)} />
          </div>
        ) : (
          <details key={card.id} open={showAnswers} className="row-hover" style={ROW_STYLE} data-testid={`card-row-${card.id}`}>
            <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', gap: 10, alignItems: 'baseline' }}>
              <span style={{ flex: 1, fontWeight: 500, whiteSpace: 'pre-wrap' }}>{card.question}</span>
              {card.editedInApp && <span className="tag orange" title="Changed in the app: Sync no longer updates this card from the repo">edited</span>}
              {card.lapses > 0 && <span className="tag red" title="Times forgotten">×{card.lapses}</span>}
              <span className="faint" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{card.topicName} · {card.dueLabel}</span>
              <span style={{ display: 'flex', gap: 2 }}>
                <button type="button" className="btn sm ghost" title="Edit" aria-label="Edit card" data-testid={`card-edit-${card.id}`}
                  onClick={(event) => { event.preventDefault(); setEditingId(card.id); }}>✎</button>
                <button type="button" className="btn sm ghost" title="Delete" aria-label="Delete card" data-testid={`card-delete-${card.id}`}
                  onClick={(event) => { event.preventDefault(); remove(card); }}>✕</button>
              </span>
            </summary>
            <div style={{ marginTop: 6, fontSize: 14 }}>
              {card.answer ? <Markdown>{card.answer}</Markdown> : <span className="faint">No answer yet.</span>}
            </div>
          </details>
        ),
      )}
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
        <span className="emoji">✅</span>
        <div>
          <b>Went through {cards.length}.</b> {forgotten > 0 ? `${forgotten} marked as forgotten, they are due tomorrow.` : 'Nothing forgotten.'}
          <div style={{ marginTop: 8 }}><button className="btn sm" onClick={onExit}>← Back to all cards</button></div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }} className="muted">
        <span>{card.topicName} · free run, schedule unchanged</span>
        <span>{position + 1} / {cards.length} · <button className="btn sm ghost" onClick={onExit}>Exit <span className="kbd">Esc</span></button></span>
      </div>
      <div className="progress" style={{ marginBottom: 12 }}>
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
          <button className="btn" onClick={() => next(true)}><span className="tag red">Forgot</span> <span className="faint" style={{ fontSize: 12 }}>due tomorrow</span> <span className="kbd">F</span></button>
        </div>
      )}
    </div>
  );
}
