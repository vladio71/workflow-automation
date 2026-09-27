import Link from 'next/link';
import { setCycleStatus, updateCycleText } from '../actions';
import { InlineText } from '@/components/InlineText';
import { Select } from '@/components/Select';
import { Tag } from '@/components/Tag';
import { db } from '@/lib/db';
import { CONFIDENCES, CYCLE_STATUSES, optionFor } from '@/lib/labels';
import type { CycleStatus } from '@/generated/prisma/enums';

const formatDay = (date: Date): string => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export default async function CyclesPage() {
  const cycles = await db.cycle.findMany({ orderBy: { number: 'asc' }, include: { topics: { orderBy: { id: 'asc' } } } });

  return (
    <div className="page wide">
      <div className="page-icon">🔁</div>
      <h1 className="page-title">Cycles</h1>
      <p className="page-sub">2 weeks, one topic, finish it before the next. System design runs weekly on the side, not as a cycle.</p>

      <div className="gallery">
        {cycles.map((cycle) => {
          const green = cycle.topics.filter((topic) => topic.confidence === 'GREEN').length;
          return (
            <div key={cycle.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="faint mono">C{cycle.number} · {formatDay(cycle.startsOn)} – {formatDay(cycle.endsOn)}</span>
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
                {cycle.topics.length === 0 && <span className="faint" style={{ fontSize: 13 }}>Assign topics on the Topics page (Cycle column).</span>}
              </div>
              <div className="faint" style={{ fontSize: 12 }}>Retro</div>
              <div style={{ fontSize: 14 }}>
                <InlineText value={cycle.retro} action={updateCycleText.bind(null, cycle.id, 'retro')} placeholder="What worked, what goes red" multiline />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
