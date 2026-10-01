'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import {
  addPlanItem, addPlanTask, generatePlan, movePlanItem, removePlanItem, reviewToday, setPlanItemDone, setPlanItemMinutes, startDay,
  type PlanActionResult,
} from '@/app/actions';
import type { PlanItemKind, PlanItemWithStatus } from '@/lib/planner';
import { MIN_ITEM_MINUTES, canMove } from '@/lib/plan-order';

export interface PlanCardPlan {
  summary: string;
  review: string;
  items: PlanItemWithStatus[];
  /** false = чернетка: пункти ще можна правити */
  started: boolean;
  focusSourceId: number | null;
  wish: string;
  budget: number;
}

/** Кандидат, якого план не взяв: його можна додати в чернетку. */
export interface AddableItem {
  id: string;
  kind: PlanItemKind;
  title: string;
  minutes: number;
}

/** Навчальний план, який можна взяти у фокус. */
export interface FocusOption {
  id: number;
  name: string;
}

interface PlanCardProps {
  plan: PlanCardPlan | null;
  geminiEnabled: boolean;
  focusOptions: FocusOption[];
  addable: AddableItem[];
}

const BUDGETS: readonly number[] = [60, 120, 180, 240, 300, 360, 480];
const DEFAULT_BUDGET = 300;
const MINUTES_STEP = 5;

const KIND_ICON: Record<PlanItemKind, string> = {
  ANKI: '🃏',
  CARDS: '🃏',
  RECALL: '🧠',
  CYCLE: '🔁',
  QUESTIONS: '❓',
  SYSTEM_DESIGN: '🏗️',
  MOCK: '🎙️',
  OUT_LOUD: '🗣️',
  INBOX: '📥',
  PLAN: '🧭',
  TASK: '📌',
};

const ROW_STYLE = { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } as const;
const LABEL_STYLE = { fontSize: 13, width: 48 } as const;

function ItemTitle({ item }: { item: PlanItemWithStatus }) {
  const style = { fontWeight: 500, textDecoration: item.done ? 'line-through' : 'none', color: item.done ? 'var(--faint)' : undefined };
  if (item.href.startsWith('http')) {
    return <a href={item.href} target="_blank" rel="noreferrer" style={style}>{item.title} ↗</a>;
  }
  return <Link href={item.href} style={style}>{item.title}</Link>;
}

export function PlanCard({ plan, geminiEnabled, focusOptions, addable }: PlanCardProps) {
  const [budget, setBudget] = useState(plan?.budget || DEFAULT_BUDGET);
  const [focus, setFocus] = useState<number | null>(plan?.focusSourceId ?? null);
  const [wish, setWish] = useState(plan?.wish ?? '');
  const [addId, setAddId] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskMinutes, setTaskMinutes] = useState(30);
  const [note, setNote] = useState<string | null>(null);
  const [planning, startPlanning] = useTransition();
  const [editing, startEditing] = useTransition();
  const [reviewing, startReviewing] = useTransition();
  const [, startToggle] = useTransition();

  const isDraft = plan !== null && !plan.started;
  const isStarted = plan !== null && plan.started;

  function draftPlan() {
    if (isStarted && !window.confirm('Перепланувати? Зроблене сьогодні лишиться в плані, решту складу заново як чернетку.')) return;
    setNote(null);
    startPlanning(async () => {
      const result = await generatePlan({ budget, focusSourceId: focus, wish });
      if (!result.ok) setNote(result.error);
      else if (result.note) setNote(result.note);
    });
  }

  /** Правка чернетки: помилку показуємо під карткою, а after скидає поле вводу тільки після успіху. */
  function edit(action: () => Promise<PlanActionResult>, after?: () => void) {
    setNote(null);
    startEditing(async () => {
      const result = await action();
      if (!result.ok) {
        setNote(result.error);
        return;
      }
      if (result.note) setNote(result.note);
      after?.();
    });
  }

  function addTask() {
    if (!taskTitle.trim()) return;
    edit(() => addPlanTask(taskTitle, taskMinutes), () => setTaskTitle(''));
  }

  function review() {
    setNote(null);
    startReviewing(async () => {
      const result = await reviewToday();
      if (!result.ok) setNote(result.error);
    });
  }

  const done = plan?.items.filter((item) => item.done).length ?? 0;
  const total = plan?.items.length ?? 0;
  const minutes = plan?.items.reduce((sum, item) => sum + item.minutes, 0) ?? 0;

  return (
    <div className="card" style={{ padding: '18px 20px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 16 }}>✨ Plan for today</b>
        {plan && (
          <span className="faint" style={{ fontSize: 13 }}>
            {isDraft ? `draft · ${total} items · ${minutes} min` : `${done}/${total} done · ${minutes} min`}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {isStarted && (
          <>
            <button className="btn" onClick={draftPlan} disabled={planning}>{planning ? 'Planning…' : 'Re-plan'}</button>
            <button className="btn" onClick={review} disabled={reviewing}>{reviewing ? 'Checking…' : '🌙 Check the day'}</button>
          </>
        )}
      </div>

      {!isStarted && (
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          {focusOptions.length > 0 && (
            <div style={ROW_STYLE}>
              <span className="faint" style={LABEL_STYLE}>Focus</span>
              {focusOptions.map((option) => {
                const active = focus === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`btn sm ${active ? 'primary' : ''}`}
                    title="План у фокусі бере ~60% бюджету і до 2 нових задач"
                    onClick={() => setFocus(active ? null : option.id)}
                  >
                    {active ? '★ ' : ''}{option.name}
                  </button>
                );
              })}
            </div>
          )}
          <div style={ROW_STYLE}>
            <span className="faint" style={LABEL_STYLE}>Wish</span>
            <input
              className="input"
              style={{ flex: 1, minWidth: 220, height: 28 }}
              value={wish}
              maxLength={300}
              placeholder="необов'язково: більше задач, без mock, сьогодні тільки повторення"
              onChange={(event) => setWish(event.target.value)}
            />
            <select className="input" style={{ width: 'auto', height: 28, padding: '0 8px' }} value={budget} onChange={(event) => setBudget(Number(event.target.value))}>
              {BUDGETS.map((value) => <option key={value} value={value}>{value} min</option>)}
            </select>
            <button className="btn primary" onClick={draftPlan} disabled={planning}>
              {planning ? 'Planning…' : isDraft ? 'Re-draft' : geminiEnabled ? 'Plan my day' : 'Plan my day (rules)'}
            </button>
          </div>
        </div>
      )}

      {note && <p className="faint" style={{ fontSize: 13, marginTop: 8 }}>{note}</p>}
      {!plan && (
        <p className="muted" style={{ fontSize: 14, marginTop: 8 }}>
          {geminiEnabled
            ? 'Steps of your study plans come first, in order (the app picks them, not AI); the plan in focus gets most of the budget. Gemini fills the rest from your data and your tasks. You get a draft: edit it, then start the day.'
            : 'Without GEMINI_API_KEY the plan is built by simple rules. You get a draft: edit it, then start the day.'}
        </p>
      )}

      {plan && (
        <>
          {plan.summary && <p className="muted" style={{ fontSize: 14, margin: '10px 0 4px' }}>{plan.summary}</p>}
          <div style={{ marginTop: 6 }}>
            {plan.items.map((item, index) => (
              <div key={item.id} data-item={item.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                {isStarted ? (
                  <button
                    className={`check ${item.done ? 'on' : ''}`}
                    style={{ background: 'none', border: 0, padding: 0, marginTop: 2, cursor: item.autoDone ? 'default' : 'pointer' }}
                    title={item.autoDone ? 'Detected automatically' : 'Mark done'}
                    onClick={() => {
                      if (item.autoDone) return;
                      startToggle(() => setPlanItemDone(item.id, !item.manualDone));
                    }}
                  >
                    <span className="box">
                      {item.done && (
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.2"><path d="M2 6.5l2.5 2.5L10 3.5" /></svg>
                      )}
                    </span>
                  </button>
                ) : (
                  <span className="faint mono" style={{ width: 18, textAlign: 'right', fontSize: 13, marginTop: 1 }}>{index + 1}</span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span>{KIND_ICON[item.kind]}</span>
                    <ItemTitle item={item} />
                    {isStarted && <span className="faint mono" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>{item.minutes}m</span>}
                  </div>
                  {item.why && <div className="faint" style={{ fontSize: 13, marginLeft: 26 }}>{item.why}</div>}
                  {item.autoDone && <div className="faint" style={{ fontSize: 12, marginLeft: 26 }}>✓ detected automatically</div>}
                </div>
                {isDraft && (
                  <div style={{ display: 'flex', gap: 2, alignItems: 'center', flexShrink: 0 }}>
                    <button className="btn sm ghost" title="−5 хв" disabled={editing || item.minutes <= MIN_ITEM_MINUTES}
                      onClick={() => edit(() => setPlanItemMinutes(item.id, item.minutes - MINUTES_STEP))}>−</button>
                    <span className="faint mono" style={{ width: 38, textAlign: 'center', fontSize: 13 }}>{item.minutes}m</span>
                    <button className="btn sm ghost" title="+5 хв" disabled={editing}
                      onClick={() => edit(() => setPlanItemMinutes(item.id, item.minutes + MINUTES_STEP))}>+</button>
                    <button className="btn sm ghost" title="Вище" disabled={editing || !canMove(plan.items, index, -1)}
                      onClick={() => edit(() => movePlanItem(item.id, -1))}>↑</button>
                    <button className="btn sm ghost" title="Нижче" disabled={editing || !canMove(plan.items, index, 1)}
                      onClick={() => edit(() => movePlanItem(item.id, 1))}>↓</button>
                    <button className="btn sm ghost" disabled={editing}
                      title={item.kind === 'PLAN' ? 'Прибрати (і наступні кроки цього плану)' : 'Прибрати'}
                      onClick={() => edit(() => removePlanItem(item.id))}>✕</button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {isDraft && (
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
              {addable.length > 0 && (
                <div style={ROW_STYLE}>
                  <select className="input" style={{ flex: 1, minWidth: 220, height: 28, padding: '0 8px' }} value={addId} onChange={(event) => setAddId(event.target.value)}>
                    <option value="">+ Add from candidates…</option>
                    {addable.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>{KIND_ICON[candidate.kind]} {candidate.title} · {candidate.minutes}m</option>
                    ))}
                  </select>
                  <button className="btn sm" disabled={editing || addId === ''} onClick={() => edit(() => addPlanItem(addId), () => setAddId(''))}>Add</button>
                </div>
              )}
              <div style={ROW_STYLE}>
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 220, height: 28 }}
                  value={taskTitle}
                  maxLength={200}
                  placeholder="+ Own task: розіслати резюме, залити апку на сервер…"
                  onChange={(event) => setTaskTitle(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') addTask(); }}
                />
                <input
                  className="input"
                  type="number"
                  min={MIN_ITEM_MINUTES}
                  max={480}
                  step={MINUTES_STEP}
                  style={{ width: 72, height: 28 }}
                  value={taskMinutes}
                  onChange={(event) => setTaskMinutes(Number(event.target.value))}
                />
                <span className="faint" style={{ fontSize: 13 }}>min</span>
                <button className="btn sm" disabled={editing || taskTitle.trim() === ''} onClick={addTask}>Add task</button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
                <button className="btn primary" disabled={editing || total === 0} onClick={() => edit(() => startDay())}>▶ Start the day</button>
                <span className="faint" style={{ fontSize: 13 }}>Поки день не почато, план можна правити. Після старту лишаться тільки галочки.</span>
              </div>
            </div>
          )}

          {plan.review && (
            <div className="callout" style={{ marginBottom: 0 }}>
              <span className="emoji">🌙</span>
              <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{plan.review}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
