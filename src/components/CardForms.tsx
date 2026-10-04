'use client';

import { useEffect, useLayoutEffect, useRef, useState, useTransition, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';
import { addCard, editCard } from '@/app/actions';

export interface TopicChoice {
  id: number;
  name: string;
}

interface AutoTextareaProps {
  value: string;
  placeholder: string;
  testId: string;
  autoFocus?: boolean;
  areaRef?: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

/** Поле, яке росте під текст. Ctrl/Cmd+Enter = зберегти, Esc = скасувати. */
function AutoTextarea({ value, placeholder, testId, autoFocus = false, areaRef, onChange, onSubmit, onCancel }: AutoTextareaProps) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = areaRef ?? ownRef;

  useLayoutEffect(() => {
    const area = ref.current;
    if (!area) return;
    area.style.height = '0px';
    area.style.height = `${area.scrollHeight + 2}px`;
  }, [value, ref]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onSubmit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <textarea
      ref={ref}
      className="textarea"
      data-testid={testId}
      value={value}
      placeholder={placeholder}
      rows={1}
      autoFocus={autoFocus}
      style={{ resize: 'none', overflow: 'hidden', display: 'block', width: '100%', minHeight: 34 }}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}

const LABEL_STYLE: CSSProperties = { fontSize: 12, margin: '8px 0 4px' };
const FORM_STYLE: CSSProperties = { border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px 12px', marginBottom: 12 };

interface NewCardFormProps {
  topics: TopicChoice[];
  /** тема, вибрана у фільтрі списку: нова картка за замовчуванням іде в неї */
  defaultTopicId: number | null;
  onClose: () => void;
}

/** All cards → New card: питання, відповідь і тема одразу. Форма лишається відкритою, щоб додати кілька підряд. */
export function NewCardForm({ topics, defaultTopicId, onClose }: NewCardFormProps) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [topicId, setTopicId] = useState<number | null>(defaultTopicId);
  const [addedCount, setAddedCount] = useState(0);
  const [pending, startTransition] = useTransition();
  const questionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setTopicId(defaultTopicId), [defaultTopicId]);

  const canSubmit = question.trim().length > 0 && !pending;
  const submit = (): void => {
    if (!canSubmit) return;
    startTransition(async () => {
      const created = await addCard({ question, answer, topicId });
      if (!created) return;
      setQuestion('');
      setAnswer('');
      setAddedCount((count) => count + 1);
      questionRef.current?.focus();
    });
  };

  return (
    <div style={FORM_STYLE} data-testid="new-card-form">
      <div className="faint" style={{ ...LABEL_STYLE, marginTop: 0 }}>Question</div>
      <AutoTextarea value={question} placeholder="What do you want to be asked?" testId="new-card-question" autoFocus
        areaRef={questionRef} onChange={setQuestion} onSubmit={submit} onCancel={onClose} />
      <div className="faint" style={LABEL_STYLE}>Answer</div>
      <AutoTextarea value={answer} placeholder="The answer you want to remember (markdown works)" testId="new-card-answer"
        onChange={setAnswer} onSubmit={submit} onCancel={onClose} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <select className="input" style={{ width: 'auto', maxWidth: 320 }} data-testid="new-card-topic" value={topicId === null ? '' : String(topicId)}
          onChange={(event) => setTopicId(event.target.value ? Number(event.target.value) : null)}>
          <option value="">No topic</option>
          {topics.map((topic) => <option key={topic.id} value={String(topic.id)}>{topic.name}</option>)}
        </select>
        <button type="button" className="btn primary" data-testid="new-card-submit" disabled={!canSubmit} onClick={submit}>
          Add card <span className="kbd">Ctrl+Enter</span>
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>Close</button>
        {addedCount > 0 && <span className="faint" style={{ fontSize: 13 }} data-testid="new-card-added">✓ {addedCount} added, new cards come up in Review</span>}
      </div>
    </div>
  );
}

export interface EditableCard {
  id: number;
  question: string;
  answer: string;
  fromRepo: boolean;
  editedInApp: boolean;
}

interface EditCardFormProps {
  card: EditableCard;
  onDone: () => void;
}

/** All cards → Edit: питання і відповідь на місці. Розклад картки не міняється. */
export function EditCardForm({ card, onDone }: EditCardFormProps) {
  const [question, setQuestion] = useState(card.question);
  const [answer, setAnswer] = useState(card.answer);
  const [pending, startTransition] = useTransition();

  const canSave = question.trim().length > 0 && !pending;
  const save = (): void => {
    if (!canSave) return;
    startTransition(async () => {
      await editCard(card.id, { question, answer });
      onDone();
    });
  };

  return (
    <div data-testid={`card-edit-form-${card.id}`}>
      <div className="faint" style={{ ...LABEL_STYLE, marginTop: 0 }}>Question</div>
      <AutoTextarea value={question} placeholder="Question" testId="edit-card-question" autoFocus
        onChange={setQuestion} onSubmit={save} onCancel={onDone} />
      <div className="faint" style={LABEL_STYLE}>Answer</div>
      <AutoTextarea value={answer} placeholder="Answer (markdown works)" testId="edit-card-answer"
        onChange={setAnswer} onSubmit={save} onCancel={onDone} />
      {card.fromRepo && !card.editedInApp && (
        <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
          This card comes from the repo. Once you save a change, Sync stops updating it from questions.md.
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="button" className="btn primary" data-testid="edit-card-save" disabled={!canSave} onClick={save}>
          Save <span className="kbd">Ctrl+Enter</span>
        </button>
        <button type="button" className="btn ghost" onClick={onDone}>Cancel <span className="kbd">Esc</span></button>
      </div>
    </div>
  );
}
