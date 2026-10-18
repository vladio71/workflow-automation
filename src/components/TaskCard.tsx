'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Compact task card on the Tasks board; clicking the title opens a dialog with the full form.
 * Server actions come from page.tsx already bound to the task id.
 */

export type TaskStatusValue = 'BACKLOG' | 'TODO' | 'IN_PROGRESS';
export type TaskNextStatus = TaskStatusValue | 'DONE';

export interface TaskCardData {
  id: number;
  title: string;
  notes: string;
  minutes: number;
  priority: number;
  repeatLabel: string;
  target: number;
  todayCount: number;
  /** "2026-10-19" or null */
  until: string | null;
  /** Caption under the title: created on / done on date, already formatted */
  sinceLabel: string;
  status: TaskStatusValue;
  done: boolean;
  prev: TaskStatusValue | null;
  next: TaskNextStatus;
}

export interface TaskCardActions {
  /** Dialog form fields: title, notes, priority, minutes, target, until */
  save: (formData: FormData) => Promise<void>;
  moveNext: () => Promise<void>;
  movePrev: () => Promise<void>;
  reopen: () => Promise<void>;
  tick: () => Promise<void>;
  remove: () => Promise<void>;
}

interface Props {
  task: TaskCardData;
  actions: TaskCardActions;
  columnLabel: Record<TaskStatusValue, string>;
  priorityLabel: Record<number, string>;
  maxTarget: number;
}

const PRIORITY_COLOR: Record<number, string> = { 1: 'red', 2: 'orange', 3: 'gray', 4: 'gray' };

export default function TaskCard({ task, actions, columnLabel, priorityLabel, maxTarget }: Props) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const session = task.target > 0;
  const priorities = Object.keys(priorityLabel).map(Number);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const nextLabel = task.next === 'DONE' ? '✓ done' : '→';
  const nextTitle = task.next === 'DONE' ? 'Зроблено' : `→ ${columnLabel[task.next]}`;

  return (
    <div className="task-card row-hover" data-task={task.id} data-status={task.done ? 'DONE' : task.status}>
      <div className="task-card-head">
        <button type="button" className="task-card-title" onClick={() => setOpen(true)} title="Відкрити">
          {session && '🏰 '}
          <span style={{ textDecoration: task.done ? 'line-through' : 'none', color: task.done ? 'var(--faint)' : undefined }}>{task.title}</span>
        </button>
        {!task.done && <span className={`tag ${PRIORITY_COLOR[task.priority] ?? 'gray'}`} title={`Пріоритет P${task.priority}`}>P{task.priority}</span>}
      </div>
      <div className="task-card-meta faint">
        {task.minutes} min · {task.repeatLabel}
        {task.until && ` · до ${task.until}`}
        {task.notes && ' · 📝'}
      </div>
      <div className="task-card-row">
        {session && !task.done && (
          <>
            <span className={`tag ${task.todayCount >= task.target ? 'green' : 'gray'}`}>{task.todayCount}/{task.target}</span>
            <form action={actions.tick}><button className="btn sm" title="Відправив ще одне">+1</button></form>
          </>
        )}
        {task.done ? (
          <form action={actions.reopen}><button className="btn sm ghost" title="Повернути в To do">↩</button></form>
        ) : (
          <>
            {task.prev && (
              <form action={actions.movePrev}><button className="btn sm ghost" title={`← ${columnLabel[task.prev]}`}>←</button></form>
            )}
            <form action={actions.moveNext}>
              <button className={`btn sm ${task.next === 'DONE' ? 'primary' : ''}`} title={nextTitle}>{nextLabel}</button>
            </form>
          </>
        )}
      </div>

      <dialog
        ref={dialogRef}
        className="modal task-modal"
        aria-labelledby={`task-${task.id}-title`}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
      >
        <form action={actions.save} onSubmit={() => setOpen(false)}>
          <div className="modal-head">
            <h2 id={`task-${task.id}-title`} style={{ fontSize: 13, fontWeight: 500, color: 'var(--faint)' }}>
              #{task.id} · {task.done ? 'Done' : columnLabel[task.status]} · {task.sinceLabel}
            </h2>
            <button type="button" className="btn ghost sm" aria-label="Закрити" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="modal-body task-modal-body">
            <input className="input task-modal-title" name="title" defaultValue={task.title} required maxLength={200} aria-label="Назва" />
            <textarea className="input task-modal-notes" name="notes" defaultValue={task.notes} maxLength={2000} rows={8} placeholder="Опис: що саме, посилання, кроки…" aria-label="Опис" />
            <div className="task-modal-grid">
              <label>
                <span className="faint">Пріоритет</span>
                <select className="input" name="priority" defaultValue={task.priority}>
                  {priorities.map((value) => (
                    <option key={value} value={value}>P{value} {priorityLabel[value]}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="faint">Хвилин</span>
                <input className="input" name="minutes" type="number" min={5} max={480} step={5} defaultValue={task.minutes} />
              </label>
              <label title="Ціль на день: 0 = звичайна справа з галочкою, більше = сесія з лічильником і баштою">
                <span className="faint">Ціль / день</span>
                <input className="input" name="target" type="number" min={0} max={maxTarget} defaultValue={task.target} />
              </label>
              <label title="До якого дня включно справа в плані; після цієї дати зникає сама">
                <span className="faint">До дня</span>
                <input className="input" name="until" type="date" defaultValue={task.until ?? ''} />
              </label>
            </div>
            <div className="faint" style={{ fontSize: 12 }}>{task.repeatLabel}{session && ` · сьогодні ${task.todayCount}/${task.target}`}</div>
          </div>
          <div className="modal-foot">
            <button className="btn primary">Зберегти</button>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Скасувати</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn ghost sm" formNoValidate onClick={() => { if (confirm('Видалити справу?')) void actions.remove(); }} title="Видалити">
              ✕ Видалити
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
