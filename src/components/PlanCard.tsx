'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition, type DragEvent } from 'react';
import {
  addLiveCodingTasks, addPlanItem, addPlanTask, generatePlan, movePlanItem, removePlanItem, reorderPlanItem, reviewToday, setPlanItemDone,
  setPlanItemMinutes, skipPlanItem, startDay, type PlanActionResult,
} from '@/app/actions';
import { openTaskSession } from '@/components/TowerCard';
import { AiStatus } from '@/components/AiStatus';
import { newJobId } from '@/lib/ai-labels';
import { DayMap, type NodeState } from '@/components/DayMap';
import { MIN_ITEM_MINUTES, canMove, findBossId } from '@/lib/plan-order';
import { NO_FOCUS, type FocusOption } from '@/lib/day-focus';
import type { PlanItemKind, PlanItemWithStatus } from '@/lib/planner';

export interface PlanCardPlan {
  summary: string;
  review: string;
  items: PlanItemWithStatus[];
  /** false = draft, items can still be edited; true = the day has started and the plan became the map */
  started: boolean;
  /** '' for no focus, 'levels' or 'plan:<id>' (see day-focus.ts) */
  focus: string;
  wish: string;
  budget: number;
  /** Why Gemini did not build the plan; '' when it did (or there is no key) */
  aiError: string;
}

/** A candidate the plan did not take; it can be added to the draft. */
export interface AddableItem {
  id: string;
  kind: PlanItemKind;
  title: string;
  minutes: number;
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
  LEVEL: '⚔️',
  TASK: '📌',
};

/** Where a dragged draft item lands: above the item with this id or below it. */
interface DropTarget {
  id: string;
  below: boolean;
}

const ROW_STYLE = { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } as const;
const LABEL_STYLE = { fontSize: 13, width: 48 } as const;

function ItemLink({ item, children, className }: { item: PlanItemWithStatus; children: React.ReactNode; className?: string }) {
  if (item.href.startsWith('http')) {
    return <a href={item.href} target="_blank" rel="noreferrer" className={className} draggable={false}>{children} ↗</a>;
  }
  // draggable={false}: in the draft the whole row is dragged, not the link inside it
  return <Link href={item.href} className={className} draggable={false}>{children}</Link>;
}

export function PlanCard({ plan, geminiEnabled, focusOptions, addable }: PlanCardProps) {
  const [budget, setBudget] = useState(plan?.budget || DEFAULT_BUDGET);
  const [focus, setFocus] = useState(plan?.focus ?? NO_FOCUS);
  const [wish, setWish] = useState(plan?.wish ?? '');
  const [addId, setAddId] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskMinutes, setTaskMinutes] = useState(30);
  const [note, setNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /** The Gemini request whose status is shown under the buttons */
  const [jobId, setJobId] = useState<string | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [planning, startPlanning] = useTransition();
  const [editing, startEditing] = useTransition();
  const [reviewing, startReviewing] = useTransition();
  const [changing, startChange] = useTransition();

  /** Drag and drop in the draft: what is dragged, where it is aimed, and the order shown until the server answers */
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [draggedOrder, setDraggedOrder] = useState<string[] | null>(null);
  const serverItems = plan?.items;
  // the server returned a new plan: show its order
  useEffect(() => setDraggedOrder(null), [serverItems]);

  const isDraft = plan !== null && !plan.started;
  const isStarted = plan !== null && plan.started;

  function draftPlan() {
    if (isStarted && !window.confirm('Перепланувати? Зроблене сьогодні лишиться на карті, решту складу заново як чернетку.')) return;
    setNote(null);
    setFailure(null);
    setPickedId(null);
    const id = newJobId();
    setJobId(id);
    startPlanning(async () => {
      const result = await generatePlan({ budget, focus, wish, jobId: id });
      if (!result.ok) setFailure(result.error);
      else if (result.note) setNote(result.note);
    });
  }

  /** Draft edit: the error is shown under the card, and after() resets the input only on success. */
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
    setFailure(null);
    const id = newJobId();
    setJobId(id);
    startReviewing(async () => {
      const result = await reviewToday(id);
      if (!result.ok) setFailure(result.error);
      else if (result.note) setFailure(result.note);
    });
  }

  const planItems = plan?.items ?? [];
  const items = draggedOrder
    ? draggedOrder.flatMap((id) => planItems.filter((item) => item.id === id))
    : planItems;

  function dragOver(event: DragEvent<HTMLDivElement>, itemId: string) {
    if (dragId === null) return;
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    setDrop({ id: itemId, below: event.clientY > box.top + box.height / 2 });
  }

  function dropItem() {
    const target = drop;
    const moving = dragId;
    setDragId(null);
    setDrop(null);
    if (target === null || moving === null || target.id === moving) return;
    const order = items.map((item) => item.id).filter((id) => id !== moving);
    const targetIndex = order.indexOf(target.id);
    if (targetIndex === -1) return;
    const toIndex = target.below ? targetIndex + 1 : targetIndex;
    order.splice(toIndex, 0, moving);
    setDraggedOrder(order);
    setNote(null);
    startEditing(async () => {
      const result = await reorderPlanItem(moving, toIndex);
      if (!result.ok) {
        setDraggedOrder(null);
        setNote(result.error);
      }
    });
  }
  const done = items.filter((item) => item.done).length;
  const minutes = items.reduce((sum, item) => sum + item.minutes, 0);
  // map: the current node is the first unfinished one; everything after it stays locked until it is cleared
  const current = items.find((item) => !item.done) ?? null;
  const currentIndex = current ? items.indexOf(current) : items.length;
  const stateOf = (item: PlanItemWithStatus): NodeState => {
    if (item.done) return 'done';
    return items.indexOf(item) === currentIndex ? 'current' : 'locked';
  };
  const bossId = findBossId(items);
  const selected = items.find((item) => item.id === pickedId) ?? current ?? items[items.length - 1] ?? null;
  const selectedState = selected ? stateOf(selected) : null;

  return (
    <div className="card" style={{ padding: '18px 20px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 16 }}>🗺️ Today&apos;s map</b>
        {plan && (
          <span className="faint" style={{ fontSize: 13 }}>
            {isDraft ? `draft · ${items.length} items · ${minutes} min` : `${done}/${items.length} cleared · ${minutes} min`}
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
                const active = focus === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    className={`btn sm ${active ? 'primary' : ''}`}
                    title="Фокус бере ~60% бюджету: більше кроків цього плану або більше рівнів"
                    onClick={() => setFocus(active ? NO_FOCUS : option.key)}
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

      {geminiEnabled && <AiStatus jobId={jobId} active={planning || reviewing} />}
      {note && <p className="faint" style={{ fontSize: 13, marginTop: 8 }}>{note}</p>}
      {failure && <p className="ai-failure" data-testid="ai-failure">⚠️ {failure}</p>}
      {plan?.aiError && !planning && (
        <div className="callout ai-error" data-testid="plan-ai-error">
          <span className="emoji">⚠️</span>
          <div style={{ fontSize: 14 }}>
            <b>Gemini не склав план</b>, тому він за правилами. {plan.aiError}.{' '}
            <Link href="/sources#gemini" style={{ textDecoration: 'underline' }}>Перевірити Gemini →</Link>
          </div>
        </div>
      )}
      {!plan && (
        <p className="muted" style={{ fontSize: 14, marginTop: 8 }}>
          {geminiEnabled
            ? 'Steps of your study plans come first, in order (the app picks them, not AI); the plan in focus gets most of the budget. Gemini fills the rest from your data: cards, levels, overdue recalls, your tasks. You get a draft: edit it, then start the day and it becomes the map.'
            : 'Without GEMINI_API_KEY the plan is built by simple rules. You get a draft: edit it, then start the day and it becomes the map.'}
        </p>
      )}

      {plan?.summary && <p className="muted" style={{ fontSize: 14, margin: '10px 0 0' }}>{plan.summary}</p>}

      {isDraft && plan && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
            <button className="btn sm" data-testid="add-live-coding" disabled={editing} onClick={() => edit(() => addLiveCodingTasks())}>
              + 3 live coding
            </button>
            <span className="faint" style={{ fontSize: 13 }}>Пункти можна перетягувати.</span>
          </div>
          <div style={{ marginTop: 6 }}>
            {items.map((item, index) => {
              const line = drop !== null && drop.id === item.id && dragId !== item.id ? (drop.below ? 'drop-below' : 'drop-above') : '';
              return (
              <div
                key={item.id}
                data-item={item.id}
                className={`plan-row ${dragId === item.id ? 'dragging' : ''} ${line}`}
                draggable={!editing}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', item.id);
                  setDragId(item.id);
                }}
                onDragEnd={() => { setDragId(null); setDrop(null); }}
                onDragOver={(event) => dragOver(event, item.id)}
                onDrop={dropItem}
              >
                <span className="grip" title="Перетягни, щоб переставити">⋮⋮</span>
                <span className="faint mono" style={{ width: 18, textAlign: 'right', fontSize: 13, marginTop: 1 }}>{index + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span>{KIND_ICON[item.kind]}</span>
                    <ItemLink item={item}><span style={{ fontWeight: 500 }}>{item.title}</span></ItemLink>
                    {item.id === bossId && <span className="faint" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>👑 boss</span>}
                  </div>
                  {item.why && <div className="faint" style={{ fontSize: 13, marginLeft: 26 }}>{item.why}</div>}
                </div>
                <div style={{ display: 'flex', gap: 2, alignItems: 'center', flexShrink: 0 }}>
                  <button className="btn sm ghost" title="−5 хв" disabled={editing || item.minutes <= MIN_ITEM_MINUTES}
                    onClick={() => edit(() => setPlanItemMinutes(item.id, item.minutes - MINUTES_STEP))}>−</button>
                  <span className="faint mono" style={{ width: 38, textAlign: 'center', fontSize: 13 }}>{item.minutes}m</span>
                  <button className="btn sm ghost" title="+5 хв" disabled={editing}
                    onClick={() => edit(() => setPlanItemMinutes(item.id, item.minutes + MINUTES_STEP))}>+</button>
                  <button className="btn sm ghost" title="Вище" disabled={editing || !canMove(items, index, -1)}
                    onClick={() => edit(() => movePlanItem(item.id, -1))}>↑</button>
                  <button className="btn sm ghost" title="Нижче" disabled={editing || !canMove(items, index, 1)}
                    onClick={() => edit(() => movePlanItem(item.id, 1))}>↓</button>
                  <button className="btn sm ghost" disabled={editing}
                    title={item.kind === 'PLAN' ? 'Прибрати (і наступні кроки цього плану)' : 'Прибрати'}
                    onClick={() => edit(() => removePlanItem(item.id))}>✕</button>
                </div>
              </div>
              );
            })}
          </div>

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
              <button className="btn primary" disabled={editing || items.length === 0} onClick={() => edit(() => startDay())}>▶ Start the day</button>
              <span className="faint" style={{ fontSize: 13 }}>Поки день не почато, план можна правити. Після старту він стане картою, і правити вже не можна.</span>
            </div>
          </div>
        </>
      )}

      {isStarted && (
        <>
          {items.length > 0 && (
            <DayMap items={items} icons={KIND_ICON} selectedId={selected?.id ?? null} bossId={bossId} stateOf={stateOf} onSelect={setPickedId} />
          )}

          {selected && selectedState && (
            <div className="callout" style={{ marginBottom: 0 }}>
              <span className="emoji">{KIND_ICON[selected.kind]}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  {selectedState === 'locked' ? (
                    <b className="muted">{selected.title}</b>
                  ) : (
                    <ItemLink item={selected}><b style={{ textDecoration: 'underline', textDecorationColor: 'var(--faint)' }}>{selected.title}</b></ItemLink>
                  )}
                  <span className="faint mono">{selected.minutes}m{selected.id === bossId ? ' · 👑 boss' : ''}</span>
                </div>
                {selected.why && <div className="muted" style={{ fontSize: 14, marginTop: 2 }}>{selected.why}</div>}
                <div style={{ fontSize: 13, marginTop: 6 }} className="faint">
                  {selectedState === 'done' && (selected.autoDone ? '✓ Cleared, detected automatically.' : '✓ Cleared, marked by hand.')}
                  {selectedState === 'locked' && current && <>🔒 Opens after “{current.title}”.</>}
                  {selectedState === 'current' && 'Your next step. Just this one, the rest of the map waits.'}
                </div>
                {selected.progress && (
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    <span className={`tag ${selected.progress.count >= selected.progress.target ? 'green' : 'gray'}`}>
                      {selected.progress.count}/{selected.progress.target} сьогодні
                    </span>{' '}
                    <span className="faint">вузол закриється сам на {selected.progress.target}</span>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  {/* session task: opens the tower session dialog instead of navigating to Tasks */}
                  {selected.progress && selectedState !== 'locked' && (
                    <button className="btn primary sm" onClick={() => openTaskSession(Number(selected.id.replace('task:', '')))}>▶ Сесія</button>
                  )}
                  {selectedState === 'current' && !selected.progress && (
                    <ItemLink item={selected} className="btn primary sm">Start</ItemLink>
                  )}
                  {/* only green tests clear a level, it cannot be ticked off by hand */}
                  {selectedState === 'current' && !selected.autoDone && selected.kind !== 'LEVEL' && (
                    <button className="btn sm" disabled={changing} onClick={() => startChange(() => setPlanItemDone(selected.id, true))}>
                      Mark done
                    </button>
                  )}
                  {selectedState === 'current' && selected.mandatory !== true && items.length > 1 && (
                    <button className="btn ghost sm" disabled={changing} onClick={() => startChange(() => skipPlanItem(selected.id))}>
                      Skip for now
                    </button>
                  )}
                  {selectedState === 'done' && selected.manualDone && !selected.autoDone && (
                    <button className="btn ghost sm" disabled={changing} onClick={() => startChange(() => setPlanItemDone(selected.id, false))}>
                      Undo
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {plan?.review && (
        <div className="callout" style={{ marginBottom: 0, marginTop: 10 }}>
          <span className="emoji">🌙</span>
          <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{plan.review}</div>
        </div>
      )}
    </div>
  );
}
