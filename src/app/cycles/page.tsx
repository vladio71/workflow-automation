import Link from 'next/link';
import { addTopicQuick, createCycle, deleteCycle, setCycleStatus, updateCycleText } from '../actions';
import { InlineText } from '@/components/InlineText';
import { Select } from '@/components/Select';
import { Tag } from '@/components/Tag';
import { db } from '@/lib/db';
import { CONFIDENCES, CYCLE_STATUSES, optionFor } from '@/lib/labels';
import type { CycleStatus } from '@/generated/prisma/enums';
import { SECTIONS, getSection } from '@/lib/sections';
import { getAllCellStatuses, getLatestAttempts } from '@/lib/progress';
import { cellOrder, drillOrder } from '@/lib/content';

export default async function CyclesPage() {
  const [cycles, statuses, attempts] = await Promise.all([
    db.cycle.findMany({ orderBy: { number: 'asc' }, include: { topics: { orderBy: { id: 'asc' } } } }),
    getAllCellStatuses(),
    getLatestAttempts(),
  ]);
  const usedSections = new Set(cycles.map((cycle) => cycle.section).filter((section) => section !== ''));
  const sectionProgress = (sectionId: string): { done: number; total: number } | null => {
    const section = getSection(sectionId);
    if (!section) return null;
    if (section.cellGroups.length > 0) {
      const cells = cellOrder().filter((cell) => section.cellGroups.includes(cell.group));
      return { done: cells.filter((cell) => statuses.get(cell.id)?.done).length, total: cells.length };
    }
    const drills = drillOrder().filter((drill) => section.moduleIds.includes(drill.id.slice(0, drill.id.lastIndexOf('-'))));
    return { done: drills.filter((drill) => attempts.has(drill.id)).length, total: drills.length };
  };

  return (
    <div className="page wide">
      <h1 className="page-title">Цикли</h1>
      <p className="page-sub">
        Одна тема на цикл, приблизно два тижні, наступний не починати, поки не закрив поточний. Цикл = розділ матеріалу:
        норма дня бере наступну клітинку або дрил тільки з нього. Вільний цикл = свої теми, як раніше.
      </p>

      <form action={createCycle} className="card" style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <select name="section" className="input" style={{ minWidth: 240 }} defaultValue={SECTIONS.find((section) => !usedSections.has(section.id))?.id ?? ''}>
          {SECTIONS.map((section) => (
            <option key={section.id} value={section.id}>{section.name}{usedSections.has(section.id) ? ' (уже є)' : ''}</option>
          ))}
          <option value="">Вільний цикл (своя назва)</option>
        </select>
        <input name="name" className="input" placeholder="Назва вільного циклу" autoComplete="off" style={{ flex: 1, minWidth: 200 }} />
        <input name="goal" className="input" placeholder="Ціль: після нього я можу…" autoComplete="off" style={{ flex: 1, minWidth: 200 }} />
        <button className="btn primary">Додати</button>
      </form>
      <p className="faint" style={{ fontSize: 13, marginTop: -8, marginBottom: 16 }}>
        Рекомендований порядок: {SECTIONS.map((section) => section.name).join(' → ')}. Для розділу назва і ціль підставляються самі.
      </p>
      {cycles.length === 0 && <p className="faint">Циклів ще нема. Перший створений стає активним.</p>}

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
              {(() => {
                const progress = sectionProgress(cycle.section);
                if (!progress) return null;
                return (
                  <div>
                    <div className="faint" style={{ fontSize: 12 }}>Розділ · {progress.done}/{progress.total}</div>
                    <div className="progress" style={{ marginTop: 4 }}><div style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
                  </div>
                );
              })()}
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
