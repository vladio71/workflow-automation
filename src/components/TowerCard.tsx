'use client';

import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import { tickTask, untickTask } from '@/app/actions';
import { Skyline, Tower } from '@/components/Tower';
import type { TowerData } from '@/lib/task-sessions';

/**
 * Башти дня на Today: по одній на кожну справу-сесію (у справи є ціль на день).
 * "▶ Сесія" відкриває попап: +1 за кожне відправлене резюме, башта росте на очах.
 * Вузол такої справи на карті відкриває той самий попап через openTaskSession.
 */
const OPEN_EVENT = 'task-session:open';
const GROW_MS = 700;

export function openTaskSession(taskId: number): void {
  window.dispatchEvent(new CustomEvent<number>(OPEN_EVENT, { detail: taskId }));
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

function SessionDialog({ tower, open, onClose }: { tower: TowerData; open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [grow, setGrow] = useState(false);
  const [pending, startTransition] = useTransition();
  const [count, addToCount] = useOptimistic(tower.count, (current: number, delta: number) => Math.max(0, current + delta));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      inputRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!grow) return;
    const timer = window.setTimeout(() => setGrow(false), GROW_MS);
    return () => window.clearTimeout(timer);
  }, [grow]);

  function plusOne() {
    setError(null);
    const text = note;
    setNote('');
    setGrow(true);
    startTransition(async () => {
      addToCount(1);
      const result = await tickTask(tower.taskId, text);
      if (!result.ok) {
        setError(result.error);
        setNote(text);
      }
    });
    inputRef.current?.focus();
  }

  function minusOne() {
    setError(null);
    startTransition(async () => {
      addToCount(-1);
      const result = await untickTask(tower.taskId);
      if (!result.ok) setError(result.error);
    });
  }

  const left = Math.max(0, tower.target - count);
  const ticks = [...tower.ticks].reverse();

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby={`session-title-${tower.taskId}`}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={`session-title-${tower.taskId}`}>🏰 {tower.title}: сесія</h2>
        <button type="button" className="btn ghost sm" aria-label="Закрити" onClick={onClose}>✕</button>
      </div>
      <div className="modal-body session">
        <div className="session-tower">
          <Tower count={count} target={tower.target} size="lg" grow={grow} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="session-count" data-testid="session-count">
            {count}<span className="faint"> / {tower.target}</span>
          </div>
          <div className="muted" style={{ marginBottom: 12 }}>
            {left > 0 ? `До цілі дня ще ${left}.` : '🚩 Ціль дня є. Далі поверхи золоті.'}
          </div>
          <form
            style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
            onSubmit={(event) => {
              event.preventDefault();
              plusOne();
            }}
          >
            <input
              ref={inputRef}
              className="input"
              style={{ flex: 1, minWidth: 180, height: 32 }}
              value={note}
              maxLength={300}
              placeholder="компанія або посилання (можна порожнє)"
              onChange={(event) => setNote(event.target.value)}
            />
            <button type="submit" className="btn primary">+1 відправив</button>
          </form>
          <button type="button" className="btn ghost sm" style={{ marginTop: 6 }} disabled={pending || count === 0} onClick={minusOne}>
            −1 (прибрати останній)
          </button>
          {error && <p style={{ color: 'var(--tag-red-fg)', fontSize: 13, marginTop: 6 }}>{error}</p>}
          {ticks.length > 0 && (
            <>
              <div className="rule-title">Сьогодні</div>
              <div className="session-log">
                {ticks.map((tick) => (
                  <div key={tick.id} className="session-log-row">
                    <span className="faint mono">{timeLabel(tick.at)}</span>
                    <span>{tick.note || <span className="faint">без нотатки</span>}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="modal-foot">
        <span className="faint" style={{ fontSize: 13 }}>Enter = +1. Опівночі башта починається заново, вчорашня йде в скайлайн.</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn primary sm" onClick={onClose}>Готово</button>
      </div>
    </dialog>
  );
}

export function TowerCard({ towers }: { towers: TowerData[] }) {
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const taskId = (event as CustomEvent<number>).detail;
      if (towers.some((tower) => tower.taskId === taskId)) setOpenId(taskId);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [towers]);

  return (
    <div className="card tower-card">
      {towers.map((tower) => {
        const complete = tower.count >= tower.target;
        return (
          <div key={tower.taskId} className="tower-row" data-testid={`tower-${tower.taskId}`}>
            <Tower count={tower.count} target={tower.target} size="md" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <b>🏰 {tower.title}</b>
                <span className={`tag ${complete ? 'green' : 'gray'}`}>{tower.count}/{tower.target} сьогодні</span>
              </div>
              <div className="faint" style={{ fontSize: 13, margin: '2px 0 8px' }}>
                {complete ? 'Ціль дня є. Кожен наступний відгук = золотий поверх.' : 'Кожен відправлений відгук = поверх. Опівночі нова башта.'}
              </div>
              <button type="button" className="btn primary sm" onClick={() => setOpenId(tower.taskId)}>▶ Сесія</button>
              <div style={{ marginTop: 10 }}>
                <Skyline days={tower.history} target={tower.target} />
              </div>
            </div>
            <SessionDialog tower={tower} open={openId === tower.taskId} onClose={() => setOpenId(null)} />
          </div>
        );
      })}
    </div>
  );
}
