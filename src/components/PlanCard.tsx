'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { generatePlan, reviewToday, setPlanItemDone, skipPlanItem } from '@/app/actions';
import { Chest } from '@/components/Chest';
import { DayMap, type NodeState } from '@/components/DayMap';
import { findBossId } from '@/lib/plan-order';
import type { ChestState } from '@/lib/loot';
import type { PlanItemWithStatus } from '@/lib/planner';

interface PlanCardProps {
  plan: { summary: string; review: string; items: PlanItemWithStatus[] } | null;
  geminiEnabled: boolean;
  /** скриня: квитки за пройдені вузли */
  chest: ChestState | null;
}

const BUDGETS: readonly number[] = [60, 120, 180, 240, 300, 360, 480];

const KIND_ICON: Record<PlanItemWithStatus['kind'], string> = {
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
};

function ItemLink({ item, children, className }: { item: PlanItemWithStatus; children: React.ReactNode; className?: string }) {
  if (item.href.startsWith('http')) {
    return <a href={item.href} target="_blank" rel="noreferrer" className={className}>{children} ↗</a>;
  }
  return <Link href={item.href} className={className}>{children}</Link>;
}

export function PlanCard({ plan, geminiEnabled, chest }: PlanCardProps) {
  const [budget, setBudget] = useState(300);
  const [note, setNote] = useState<string | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [planning, startPlanning] = useTransition();
  const [reviewing, startReviewing] = useTransition();
  const [changing, startChange] = useTransition();

  function plan_() {
    setNote(null);
    setPickedId(null);
    startPlanning(async () => {
      const result = await generatePlan(budget);
      if (!result.ok) setNote(result.error);
      else if (result.note) setNote(result.note);
    });
  }

  function review() {
    setNote(null);
    startReviewing(async () => {
      const result = await reviewToday();
      if (!result.ok) setNote(result.error);
    });
  }

  const items = plan?.items ?? [];
  const done = items.filter((item) => item.done).length;
  const minutes = items.reduce((sum, item) => sum + item.minutes, 0);
  // поточний вузол = перший невиконаний; все після нього закрите, поки його не пройдеш
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
        {plan && <span className="faint" style={{ fontSize: 13 }}>{done}/{items.length} cleared · {minutes} min</span>}
        <span style={{ flex: 1 }} />
        <select className="input" style={{ width: 'auto', height: 28, padding: '0 8px' }} value={budget} onChange={(event) => setBudget(Number(event.target.value))}>
          {BUDGETS.map((value) => <option key={value} value={value}>{value} min</option>)}
        </select>
        <button className="btn primary" onClick={plan_} disabled={planning}>
          {planning ? 'Planning…' : plan ? 'Re-plan' : geminiEnabled ? 'Plan my day' : 'Plan my day (rules)'}
        </button>
        {plan && (
          <button className="btn" onClick={review} disabled={reviewing}>{reviewing ? 'Checking…' : '🌙 Check the day'}</button>
        )}
      </div>

      {note && <p className="faint" style={{ fontSize: 13, marginTop: 8 }}>{note}</p>}
      {!plan && (
        <p className="muted" style={{ fontSize: 14, marginTop: 8 }}>
          {geminiEnabled
            ? 'Steps of your study plan come first, in order (the app picks them, not AI). Gemini fills the rest of the budget from your data: cards, levels, overdue recalls, the current cycle. It never invents topics.'
            : 'Without GEMINI_API_KEY the plan is built by simple rules.'}
        </p>
      )}

      {plan && (
        <>
          {plan.summary && <p className="muted" style={{ fontSize: 14, margin: '8px 0 0' }}>{plan.summary}</p>}
          {items.length > 0 && (
            <DayMap items={items} icons={KIND_ICON} selectedId={selected?.id ?? null} bossId={bossId} stateOf={stateOf} onSelect={setPickedId} />
          )}

          {chest && items.length > 0 && <Chest state={chest} nextTitle={current?.title ?? null} />}

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
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  {selectedState === 'current' && (
                    <ItemLink item={selected} className="btn primary sm">Start</ItemLink>
                  )}
                  {/* рівень закривають тільки зелені тести, галочкою його не пройти */}
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

          {plan.review && (
            <div className="callout" style={{ marginBottom: 0, marginTop: 10 }}>
              <span className="emoji">🌙</span>
              <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{plan.review}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
