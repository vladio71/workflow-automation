'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition, type CSSProperties, type DragEvent } from 'react';
import { previewCardImport, runCardImport, type CardImportOutcome } from '@/app/actions';
import { CategoryPicker, type CategoryOption } from '@/components/CategoryPicker';
import { categoryHref } from '@/lib/card-links';
import type { ImportPreview } from '@/lib/import-cards';

interface ImportFormProps {
  categories: CategoryOption[];
}

const LABEL_STYLE: CSSProperties = { fontSize: 12, margin: '10px 0 4px' };
const FORM_STYLE: CSSProperties = { border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px 12px', marginBottom: 12 };
const PLACEHOLDER = `Q: Що таке ledger?
A: Append-only журнал: кожна зміна балансу окремим рядком...

Q: Навіщо wallets.balance, якщо є ledger?
A: Кеш суми і рядок, який лочать FOR UPDATE.`;

/**
 * Import: текст або .md → передпоказ (скільки карток, помилки) → категорія і дедлайн → Import.
 * Передпоказ рахує сервер тим самим парсером, що й Sync, з невеликою затримкою після вводу.
 */
export function ImportForm({ categories }: ImportFormProps) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [topicId, setTopicId] = useState<number | null>(null);
  const [deadline, setDeadline] = useState('');
  const [outcome, setOutcome] = useState<CardImportOutcome | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!text.trim()) {
      setPreview(null);
      return;
    }
    const timer = setTimeout(() => {
      void previewCardImport(text).then(setPreview);
    }, 300);
    return () => clearTimeout(timer);
  }, [text]);

  const readFile = (file: File | undefined): void => {
    if (!file) return;
    void file.text().then((content) => {
      setText(content);
      setOutcome(null);
    });
  };

  const onDrop = (event: DragEvent<HTMLTextAreaElement>): void => {
    event.preventDefault();
    setDragging(false);
    readFile(event.dataTransfer.files[0]);
  };

  const ready = preview !== null && preview.errors.length === 0 && preview.cards.length > 0 && !pending;
  const submit = (): void => {
    if (!ready) return;
    startTransition(async () => {
      const result = await runCardImport(text, { topicId, deadline });
      setOutcome(result);
      if (result.ok) setText('');
    });
  };

  return (
    <div style={FORM_STYLE} data-testid="import-form">
      <div className="faint" style={{ ...LABEL_STYLE, marginTop: 0 }}>
        Text in Q:/A: format · or drop a .md file ·{' '}
        <label style={{ textDecoration: 'underline', cursor: 'pointer' }}>
          choose file
          <input type="file" accept=".md,.txt,text/plain,text/markdown" style={{ display: 'none' }}
            onChange={(event) => readFile(event.target.files?.[0])} />
        </label>
      </div>
      <textarea
        className="textarea"
        data-testid="import-text"
        value={text}
        placeholder={PLACEHOLDER}
        rows={14}
        style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 13, borderColor: dragging ? 'var(--accent)' : undefined }}
        onChange={(event) => { setText(event.target.value); setOutcome(null); }}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      />

      {preview && (
        <div style={{ fontSize: 13, marginTop: 6 }} data-testid="import-preview">
          {preview.errors.length > 0 ? (
            <div style={{ color: '#eb5757' }}>
              {preview.errors.map((error) => <div key={error}>{error}</div>)}
            </div>
          ) : (
            <span className="faint">
              {preview.cards.length} card{preview.cards.length === 1 ? '' : 's'} recognised
              {preview.skippedTasks > 0 && ` · ${preview.skippedTasks} T: task${preview.skippedTasks === 1 ? '' : 's'} skipped (tasks come only through a repo)`}
            </span>
          )}
        </div>
      )}

      <div className="faint" style={LABEL_STYLE}>Category</div>
      <CategoryPicker value={topicId} categories={categories} onChoose={setTopicId} testId="import-category" />

      <div className="faint" style={LABEL_STYLE}>Deadline (optional)</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="date" value={deadline} disabled={topicId === null} onChange={(event) => setDeadline(event.target.value)} style={{ fontSize: 14 }} />
        <span className="faint" style={{ fontSize: 13 }}>
          {topicId === null
            ? 'Pick a category to set a deadline.'
            : 'Until this date the category comes first in Review and repeats every 1, 2, 4… days. After it, normal schedule.'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" className="btn primary" data-testid="import-submit" disabled={!ready} onClick={submit}>
          {pending ? 'Importing…' : 'Import'}
        </button>
        {outcome?.ok && (
          <span className="faint" style={{ fontSize: 13 }} data-testid="import-done">
            ✓ {outcome.result.added} added, {outcome.result.updated} updated
            {outcome.result.topicId !== null && (
              <> · <Link href={categoryHref(outcome.result.topicId)} style={{ textDecoration: 'underline' }}>open category</Link></>
            )}
          </span>
        )}
        {outcome && !outcome.ok && <span style={{ color: '#eb5757', fontSize: 13 }}>{outcome.error}</span>}
      </div>
    </div>
  );
}
