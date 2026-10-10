'use client';

import { useState, useTransition } from 'react';
import { saveDrillAttemptNow, setDrillCheckedNow } from '@/app/actions';

export interface DrillAttemptView {
  id: number;
  answer: string;
  checked: number[];
  createdAt: string;
}

interface DrillFormProps {
  drillId: string;
  reference: string[];
  checklist: string[];
  latest: DrillAttemptView | null;
  attemptCount: number;
}

/** Дрил: своя відповідь → еталон → чекліст. Кожне збереження = нова спроба, чекліст живе на спробі. */
export function DrillForm({ drillId, reference, checklist, latest, attemptCount }: DrillFormProps) {
  const [answer, setAnswer] = useState('');
  const [attempt, setAttempt] = useState<DrillAttemptView | null>(latest);
  const [count, setCount] = useState(attemptCount);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const save = (): void => {
    const text = answer.trim();
    if (!text) return;
    startTransition(async () => {
      const result = await saveDrillAttemptNow(drillId, text);
      setAttempt({ id: result.attemptId, answer: text, checked: [], createdAt: new Date().toISOString() });
      setCount((value) => value + 1);
      setAnswer('');
      setOpen(true);
    });
  };

  const toggle = (index: number): void => {
    if (!attempt) return;
    const next = attempt.checked.includes(index) ? attempt.checked.filter((value) => value !== index) : [...attempt.checked, index].sort((a, b) => a - b);
    setAttempt({ ...attempt, checked: next });
    startTransition(async () => {
      await setDrillCheckedNow(attempt.id, next);
    });
  };

  return (
    <div className="drill-form">
      <textarea
        id={`drill-${drillId}`}
        className="input area"
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        placeholder={attempt ? 'Нова спроба: відповідай з нуля, не дивлячись у минулу.' : 'Твоя відповідь. Коротко, пунктами.'}
        rows={5}
      />
      <div className="step-actions">
        <button type="button" className="btn primary" onClick={save} disabled={pending || !answer.trim()}>Зберегти відповідь</button>
        {attempt && (
          <button type="button" className="btn" onClick={() => setOpen((value) => !value)}>{open ? 'Сховати еталон' : 'Показати еталон'}</button>
        )}
        {!attempt && <span className="faint" style={{ fontSize: 13 }}>Еталон відкриється після збереження відповіді.</span>}
        {count > 0 && <span className="faint mono" style={{ fontSize: 12 }}>спроб: {count}</span>}
      </div>

      {attempt && open && (
        <div className="ref-cols" style={{ marginTop: 12 }}>
          <div>
            <span className="lbl">Еталон</span>
            <ul>{reference.map((line) => <li key={line}>{line}</li>)}</ul>
            <span className="lbl" style={{ marginTop: 12 }}>Моя відповідь · {new Date(attempt.createdAt).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}</span>
            <p className="muted" style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{attempt.answer}</p>
          </div>
          <div className="drill-check">
            <span className="lbl">Чи є це у моїй відповіді</span>
            {checklist.map((line, index) => (
              <label key={line}>
                <input type="checkbox" checked={attempt.checked.includes(index)} onChange={() => toggle(index)} />
                <span>{line}</span>
              </label>
            ))}
            <span className="faint mono" style={{ fontSize: 12, marginTop: 6, display: 'block' }}>{attempt.checked.length}/{checklist.length}</span>
          </div>
        </div>
      )}
    </div>
  );
}
