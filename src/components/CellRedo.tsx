'use client';

import { useState, useTransition } from 'react';
import { saveCellRedoNow } from '@/app/actions';

export interface RedoView {
  id: number;
  text: string;
  createdAt: string;
}

/** Повтор закритої клітинки: по пам'яті, без схеми на екрані. Після збереження звіряєш зі схемою вище. */
export function CellRedo({ cellId, redos }: { cellId: string; redos: RedoView[] }) {
  const [text, setText] = useState('');
  const [list, setList] = useState(redos);
  const [pending, startTransition] = useTransition();

  const save = (): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    startTransition(async () => {
      await saveCellRedoNow(cellId, trimmed);
      setList((current) => [{ id: Date.now(), text: trimmed, createdAt: new Date().toISOString() }, ...current]);
      setText('');
    });
  };

  return (
    <section className="step" id="redo">
      <h3 className="block-title">Повтор по пам&apos;яті {list.length > 0 && <span className="faint mono" style={{ fontSize: 12, fontWeight: 400 }}>{list.length}</span>}</h3>
      <p className="muted" style={{ fontSize: 14, marginBottom: 8 }}>
        Не дивись на схему. Які блоки, стрілки, яка база, що зламалось на групі нижче і чому саме так. Потім звір зі схемою і своїм підсумком.
      </p>
      <textarea id={`redo-${cellId}`} className="input area" value={text} onChange={(event) => setText(event.target.value)} placeholder="По пам'яті: …" rows={6} />
      <div className="step-actions">
        <button type="button" className="btn primary" onClick={save} disabled={pending || !text.trim()}>Зберегти повтор</button>
      </div>
      {list.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>Минулі повтори</summary>
          {list.map((redo) => (
            <div key={redo.id} className="box" style={{ marginTop: 8 }}>
              <b className="box-key">{new Date(redo.createdAt).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}</b>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{redo.text}</div>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
