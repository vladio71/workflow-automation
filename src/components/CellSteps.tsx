'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { markCellCheckedNow, saveCellDerivedNow, saveCellSummaryNow } from '@/app/actions';

export interface CellStepsProgress {
  derived: string;
  derivedAt: string | null;
  checkedAt: string | null;
  summary: string;
  summarizedAt: string | null;
}

interface CellStepsProps {
  cellId: string;
  progress: CellStepsProgress;
  /** «Чому саме так», «Ще не треба», приклад: відкривається на кроці 2 */
  children: ReactNode;
}

function when(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
}

/**
 * Три кроки клітинки: вивів сам → звірив → своїми словами. Клітинка закрита, коли є всі три.
 * Пояснення відкривається тільки на кроці 2, щоб спершу подумати самому.
 */
export function CellSteps({ cellId, progress, children }: CellStepsProps) {
  const [derived, setDerived] = useState(progress.derived);
  const [summary, setSummary] = useState(progress.summary);
  const [derivedAt, setDerivedAt] = useState(progress.derivedAt);
  const [checkedAt, setCheckedAt] = useState(progress.checkedAt);
  const [summarizedAt, setSummarizedAt] = useState(progress.summarizedAt);
  const [open, setOpen] = useState(progress.checkedAt !== null);
  const [pending, startTransition] = useTransition();
  const steps = [derivedAt, checkedAt, summarizedAt].filter((value) => value !== null).length;

  const saveDerived = (): void => {
    startTransition(async () => {
      await saveCellDerivedNow(cellId, derived);
      if (derived.trim()) setDerivedAt(new Date().toISOString());
    });
  };
  const check = (): void => {
    setOpen(true);
    if (checkedAt) return;
    startTransition(async () => {
      await markCellCheckedNow(cellId);
      setCheckedAt(new Date().toISOString());
    });
  };
  const saveSummary = (): void => {
    startTransition(async () => {
      await saveCellSummaryNow(cellId, summary);
      if (summary.trim()) setSummarizedAt(new Date().toISOString());
    });
  };

  return (
    <div className="steps">
      <div className="steps-head">
        <span className={`step-dot${derivedAt ? ' on' : ''}`}>1</span>
        <span className={`step-dot${checkedAt ? ' on' : ''}`}>2</span>
        <span className={`step-dot${summarizedAt ? ' on' : ''}`}>3</span>
        <span className="muted" style={{ fontSize: 13 }}>
          {steps === 3 ? 'Клітинка закрита.' : `${steps}/3 · готово = можеш намалювати систему по пам'яті і пояснити за 1,5 хв, чому кожен блок там стоїть.`}
        </span>
      </div>

      <section className="step">
        <h3 className="block-title">1 · Вивів сам {derivedAt && <span className="faint mono" style={{ fontSize: 12, fontWeight: 400 }}>{when(derivedAt)}</span>}</h3>
        <p className="muted" style={{ fontSize: 14, marginBottom: 8 }}>
          Дивись на масштаб, біль і схему. Що б ти побудував і чому: які блоки, де черга, яка база, що з'явилось порівняно з групою нижче. Пройди по патернах, перш ніж відкривати пояснення.
        </p>
        <textarea
          id={`derived-${cellId}`}
          className="input area"
          value={derived}
          onChange={(event) => setDerived(event.target.value)}
          placeholder="Моя версія: …"
          rows={6}
        />
        <div className="step-actions">
          <button type="button" className="btn primary" onClick={saveDerived} disabled={pending || !derived.trim()}>Зберегти свою версію</button>
        </div>
      </section>

      <section className="step">
        <h3 className="block-title">2 · Звірив {checkedAt && <span className="faint mono" style={{ fontSize: 12, fontWeight: 400 }}>{when(checkedAt)}</span>}</h3>
        {!open ? (
          <div className="step-actions">
            <button type="button" className={`btn ${derivedAt ? 'primary' : ''}`} onClick={check}>Відкрити «Чому саме так»</button>
            {!derivedAt && <span className="faint" style={{ fontSize: 13 }}>Краще спершу зберегти свою версію: тоді є з чим порівняти.</span>}
          </div>
        ) : (
          <>
            {children}
            <div className="step-actions"><button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>Сховати</button></div>
          </>
        )}
      </section>

      <section className="step">
        <h3 className="block-title">3 · Своїми словами {summarizedAt && <span className="faint mono" style={{ fontSize: 12, fontWeight: 400 }}>{when(summarizedAt)}</span>}</h3>
        <p className="muted" style={{ fontSize: 14, marginBottom: 8 }}>
          Після звірки: що змінилось у твоїй версії і чому, одним абзацом. З цього тексту потім робляться картки.
        </p>
        <textarea
          id={`summary-${cellId}`}
          className="input area"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="Своїми словами: …"
          rows={5}
        />
        <div className="step-actions">
          <button type="button" className="btn primary" onClick={saveSummary} disabled={pending || !summary.trim()}>Зберегти підсумок</button>
        </div>
      </section>
    </div>
  );
}
