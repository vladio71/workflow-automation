import Link from 'next/link';
import { setPlanItemDone, startDay } from '../actions';
import { CheckItem } from '@/components/CheckItem';
import { db } from '@/lib/db';
import { getFirstStep, handoffDay } from '@/lib/handoff';
import { ensureTodayPlan } from '@/lib/plan-auto';
import { getTodayPlan } from '@/lib/planner';

/**
 * Page for the overlay (desk.py, Pause key): today's first step, the day list with checkboxes,
 * "Start the day". No sidebar (.mini hides it via CSS). Same as Today, only shorter.
 */

export const dynamic = 'force-dynamic';

async function planNow(): Promise<void> {
  'use server';
  await ensureTodayPlan();
}

async function startNow(): Promise<void> {
  'use server';
  await startDay();
}

export default async function MiniPage() {
  const now = new Date();
  const [plan, firstStep, next] = await Promise.all([
    getTodayPlan(now),
    getFirstStep(now),
    db.handoff.findUnique({ where: { day: handoffDay(now) } }),
  ]);
  const total = plan ? plan.items.length : 0;
  const done = plan ? plan.items.filter((item) => item.done).length : 0;
  const started = plan !== null && plan.startedAt !== null;
  const allDone = started && total > 0 && done === total;
  const dateLabel = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className="page mini">
      {firstStep && (
        <div className="callout mini-first">
          <span className="emoji">▶️</span>
          <div>
            <div className="faint" style={{ fontSize: 12 }}>Починаю з</div>
            <div style={{ fontWeight: 600 }}>{firstStep}</div>
          </div>
        </div>
      )}

      <div className="mini-head">
        <span className="muted">{dateLabel}</span>
        {plan && <span className="mono muted">{done}/{total}</span>}
      </div>
      {plan && (
        <div className="progress" style={{ marginBottom: 10 }}>
          <div style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
      )}

      {!plan && (
        <form action={planNow} style={{ margin: '6px 0 12px' }}>
          <button className="btn primary">Скласти план на сьогодні</button>
        </form>
      )}

      {plan && !started && (
        <form action={startNow} style={{ margin: '6px 0 12px' }}>
          <button className="btn primary">Start the day</button>
        </form>
      )}

      {plan && plan.items.map((item) => (
        <CheckItem
          key={item.id}
          checked={item.done}
          action={setPlanItemDone.bind(null, item.id)}
          label={(
            <span>
              {item.title}
              <span className="faint mono" style={{ fontSize: 12 }}> · {item.minutes}m</span>
              {item.progress && <span className="faint" style={{ fontSize: 12 }}> · {item.progress.count}/{item.progress.target}</span>}
            </span>
          )}
        />
      ))}

      {allDone && <p className="muted" style={{ marginTop: 10 }}>Усе закрито. Вільний.</p>}

      {next && (
        <p className="faint" style={{ fontSize: 13, marginTop: 14 }}>
          Завтра починаю з: {next.firstStep}
        </p>
      )}

      <p style={{ marginTop: 16 }}>
        <Link href="/" className="faint" style={{ fontSize: 13, textDecoration: 'underline' }}>Today</Link>
      </p>
    </div>
  );
}
