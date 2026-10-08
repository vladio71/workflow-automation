'use client';

import { useRouter } from 'next/navigation';
import { useLayoutEffect, useRef, useState, useTransition, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';
import { addCard, chooseCardCategory, editCard, removeCard } from '@/app/actions';
import { CategoryPicker, type CategoryOption } from '@/components/CategoryPicker';

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
  categories: CategoryOption[];
  /** категорія, з якої прийшов: нова картка за замовчуванням іде в неї */
  defaultTopicId: number | null;
  /** куди повертає Close і Esc */
  backHref: string;
}

/** Сторінка New card: питання, відповідь і категорія. Форма лишається відкритою, щоб додати кілька підряд. */
export function NewCardForm({ categories, defaultTopicId, backHref }: NewCardFormProps) {
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [topicId, setTopicId] = useState<number | null>(defaultTopicId);
  const [addedCount, setAddedCount] = useState(0);
  const [pending, startTransition] = useTransition();
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const close = (): void => router.push(backHref);

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
      <div className="faint" style={{ ...LABEL_STYLE, marginTop: 0 }}>Category</div>
      <CategoryPicker value={topicId} categories={categories} onChoose={setTopicId} testId="new-card-category" />
      <div className="faint" style={LABEL_STYLE}>Question</div>
      <AutoTextarea value={question} placeholder="What do you want to be asked?" testId="new-card-question" autoFocus
        areaRef={questionRef} onChange={setQuestion} onSubmit={submit} onCancel={close} />
      <div className="faint" style={LABEL_STYLE}>Answer</div>
      <AutoTextarea value={answer} placeholder="The answer you want to remember (markdown works)" testId="new-card-answer"
        onChange={setAnswer} onSubmit={submit} onCancel={close} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn primary" data-testid="new-card-submit" disabled={!canSubmit} onClick={submit}>
          Add card <span className="kbd">Ctrl+Enter</span>
        </button>
        <button type="button" className="btn ghost" onClick={close}>Close <span className="kbd">Esc</span></button>
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

/** Питання і відповідь картки. Розклад картки не міняється. */
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

export interface EditorCard extends EditableCard {
  topicId: number | null;
  topicName: string;
}

interface CardEditorProps {
  card: EditorCard;
  categories: CategoryOption[];
  /** куди повертає Save, Cancel і Delete */
  backHref: string;
}

/** Сторінка картки: категорія, питання, відповідь, видалення. */
export function CardEditor({ card, categories, backHref }: CardEditorProps) {
  const router = useRouter();
  const [topicId, setTopicId] = useState<number | null>(card.topicId);
  const [, startTransition] = useTransition();
  const back = (): void => router.push(backHref);

  const choose = (next: number | null): void => {
    setTopicId(next);
    startTransition(async () => {
      const changed = await chooseCardCategory(card.id, next);
      if (!changed) setTopicId(card.topicId);
    });
  };

  const remove = (): void => {
    const note = card.fromRepo ? '\n\nIt comes from the repo: Sync will not bring it back.' : '';
    if (!window.confirm(`Delete this card?${note}`)) return;
    startTransition(async () => {
      await removeCard(card.id);
      back();
    });
  };

  return (
    <div style={FORM_STYLE}>
      <div className="faint" style={{ ...LABEL_STYLE, marginTop: 0 }}>Category</div>
      {card.fromRepo ? (
        <div style={{ fontSize: 14 }}>
          {card.topicName} <span className="faint" style={{ fontSize: 12 }}>· set by the card&apos;s folder in the repo</span>
        </div>
      ) : (
        <CategoryPicker value={topicId} categories={categories} onChoose={choose} testId="card-category" />
      )}
      <div style={{ marginTop: 8 }}>
        <EditCardForm card={card} onDone={back} />
      </div>
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 10 }}>
        <button type="button" className="btn ghost sm" data-testid="card-delete" onClick={remove}>✕ Delete card</button>
      </div>
    </div>
  );
}
