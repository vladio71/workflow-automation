'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { generatePlan, reviewToday, setPlanItemDone } from '@/app/actions';
import type { PlanItemWithStatus } from '@/lib/planner';

interface PlanCardProps {
  plan: { summary: string; review: string; items: PlanItemWithStatus[] } | null;
  geminiEnabled: boolean;
}

const BUDGETS: readonly number[] = [30, 60, 90, 120, 180];

const KIND_ICON: Record<PlanItemWithStatus['kind'], string> = {
  ANKI: '🃏',
  RECALL: '🧠',
  CYCLE: '🔁',
  QUESTIONS: '❓',
  SYSTEM_DESIGN: '🏗️',
  MOCK: '🎙️',
  OUT_LOUD: '🗣️',
  INBOX: '📥',
};

export function PlanCard({ plan, geminiEnabled }: PlanCardProps) {
  const [budget, setBudget] = useState(90);
  const [note, setNote] = useState<string | null>(null);
  const [planning, startPlanning] = useTransition();
  const [reviewing, startReviewing] = useTransition();
  const [, startToggle] = useTransition();

  function plan_() {
    setNote(null);
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

  const done = plan?.items.filter((item) => item.done).length ?? 0;
  const total = plan?.items.length ?? 0;
  const minutes = plan?.items.reduce((sum, item) => sum + item.minutes, 0) ?? 0;

  return (
    <div className="card" style={{ padding: '18px 20px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 16 }}>✨ Plan for today</b>
        {plan && <span className="faint" style={{ fontSize: 13 }}>{done}/{total} done · {minutes} min</span>}
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
            ? 'Gemini picks 3-5 items from your data: overdue recalls, the current cycle, system design, mock. It never invents topics.'
            : 'Without GEMINI_API_KEY the plan is built by simple rules.'}
        </p>
      )}

      {plan && (
        <>
          {plan.summary && <p className="muted" style={{ fontSize: 14, margin: '8px 0 4px' }}>{plan.summary}</p>}
          <div style={{ marginTop: 6 }}>
            {plan.items.map((item) => (
              <div key={item.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
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
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span>{KIND_ICON[item.kind]}</span>
                    <Link href={item.href} style={{ fontWeight: 500, textDecoration: item.done ? 'line-through' : 'none', color: item.done ? 'var(--faint)' : undefined }}>
                      {item.title}
                    </Link>
                    <span className="faint mono" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>{item.minutes}m</span>
                  </div>
                  {item.why && <div className="faint" style={{ fontSize: 13, marginLeft: 26 }}>{item.why}</div>}
                  {item.autoDone && <div className="faint" style={{ fontSize: 12, marginLeft: 26 }}>✓ detected automatically</div>}
                </div>
              </div>
            ))}
          </div>
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
