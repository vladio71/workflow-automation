import Link from 'next/link';
import { addTopicQuick, createCycle, deleteCycle, setCycleStatus, updateCycleText } from '../actions';
import { InlineText } from '@/components/InlineText';
import { Select } from '@/components/Select';
import { Tag } from '@/components/Tag';
import { db } from '@/lib/db';
import { CONFIDENCES, CYCLE_STATUSES, optionFor } from '@/lib/labels';
import type { CycleStatus } from '@/generated/prisma/enums';

export default async function CyclesPage() {
  const cycles = await db.cycle.findMany({ orderBy: { number: 'asc' }, include: { topics: { orderBy: { id: 'asc' } } } });

  return (
    <div className="page wide">
      <div className="page-icon">🔁</div>
      <h1 className="page-title">Cycles</h1>
      <p className="page-sub">Your plan: one focus at a time, roughly two weeks, finish it before the next. No fixed dates, just order and status.</p>

      <form action={createCycle} className="card" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input name="name" className="input" placeholder="New cycle: what are you learning for the next ~2 weeks?" autoComplete="off" />
        <input name="goal" className="input" placeholder="Goal: after it I can…" autoComplete="off" />
        <button className="btn primary">Add</button>
      </form>
      {cycles.length === 0 && <p className="faint">No cycles yet. Add your first one above. The first cycle becomes active.</p>}

      <div className="gallery">
        {cycles.map((cycle) => {
          const green = cycle.topics.filter((topic) => topic.confidence === 'GREEN').length;
          return (
            <div key={cycle.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="faint mono">Cycle {cycle.number}</span>
                <Select<CycleStatus> value={cycle.status} options={CYCLE_STATUSES} action={setCycleStatus.bind(null, cycle.id)} />
              </div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>
                <InlineText value={cycle.name} action={updateCycleText.bind(null, cycle.id, 'name')} />
              </div>
              <div className="faint" style={{ fontSize: 12 }}>Goal</div>
              <div style={{ fontSize: 14 }}>
                <InlineText value={cycle.goal} action={updateCycleText.bind(null, cycle.id, 'goal')} placeholder="After this cycle I can…" multiline />
              </div>
              <div className="faint" style={{ fontSize: 12 }}>Topics · {green}/{cycle.topics.length} green</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {cycle.topics.map((topic) => {
                  const confidence = optionFor(CONFIDENCES, topic.confidence);
                  return (
                    <Link key={topic.id} href={`/topics/${topic.id}`} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
                      <Tag color={confidence.color}>{confidence.label[0]}</Tag> {topic.name}
                    </Link>
                  );
                })}
                <form action={addTopicQuick}>
                  <input type="hidden" name="cycleId" value={cycle.id} />
                  <input type="hidden" name="track" value="OTHER" />
                  <input name="name" className="input" placeholder="+ Add topic to this cycle (Enter)" autoComplete="off" style={{ fontSize: 13, height: 28 }} />
                </form>
              </div>
              <div className="faint" style={{ fontSize: 12 }}>Retro</div>
              <div style={{ fontSize: 14 }}>
                <InlineText value={cycle.retro} action={updateCycleText.bind(null, cycle.id, 'retro')} placeholder="What worked, what goes red" multiline />
              </div>
              <form action={deleteCycle.bind(null, cycle.id)} style={{ marginTop: 'auto' }}>
                <button className="btn sm ghost">Delete cycle</button>
              </form>
            </div>
          );
        })}
      </div>
    </div>
  );
}
