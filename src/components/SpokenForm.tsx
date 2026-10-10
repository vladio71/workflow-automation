'use client';

import { useState, useTransition } from 'react';
import { addSpokenAnswerNow } from '@/app/actions';

/** Слот «вголос»: розказав, записав одним рядком, що не вийшло сказати. Таймера нема. */
export function SpokenForm({ subjectKey }: { subjectKey: string }) {
  const [stuck, setStuck] = useState('');
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  if (saved) return <span className="muted" style={{ fontSize: 13 }}>Записано.</span>;
  return (
    <form
      className="spoken-form"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          await addSpokenAnswerNow(subjectKey, stuck);
          setSaved(true);
        });
      }}
    >
      <input
        id={`spoken-${subjectKey}`}
        className="input"
        value={stuck}
        onChange={(event) => setStuck(event.target.value)}
        placeholder="Що не вийшло сказати англійською (можна порожньо)"
        autoComplete="off"
      />
      <button className="btn primary sm" disabled={pending}>Розказав</button>
    </form>
  );
}
