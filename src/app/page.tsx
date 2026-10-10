import Link from 'next/link';
import { LogTime } from '@/components/LogTime';
import { TowerCard } from '@/components/TowerCard';
import { QuickCapture } from '@/components/QuickCapture';
import { AutoSync } from '@/components/AutoSync';
import { SpokenForm } from '@/components/SpokenForm';
import { formatMinutes, getAnalytics } from '@/lib/activity';
import { getTowers } from '@/lib/task-sessions';
import { getDailyNorm } from '@/lib/norm';
import { getParking } from '@/lib/progress';
import { getStudyPlans, planProgress, stepHref } from '@/lib/study-plan';
import { db } from '@/lib/db';

export default async function TodayPage() {
  const now = new Date();
  const [norm, stats, allTopics, towers, parking, studyPlans] = await Promise.all([
    getDailyNorm(now),
    getAnalytics(7, now),
    db.topic.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    getTowers(now),
    getParking(),
    getStudyPlans(),
  ]);
  const dateLabel = now.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });
  const isSunday = now.getDay() === 0;
  const doneCount = norm.slots.filter((slot) => slot.done).length;
  const openCount = norm.slots.filter((slot) => !slot.done && !slot.empty).length;

  return (
    <div className="page">
      <AutoSync />
      <h1 className="page-title">Сьогодні</h1>
      <p className="page-sub">
        {dateLabel} · {stats.streak.current} дн. поспіль · {formatMinutes(stats.todayMinutes)} сьогодні · {formatMinutes(stats.weekMinutes)} за тиждень
      </p>

      {norm.cycle ? (
        <div className="cycle-strip">
          <div>
            <span className="lbl">Цикл {norm.cycle.number}</span>
            <Link href="/cycles" style={{ fontWeight: 600, fontSize: 16 }}>{norm.cycle.name}</Link>
            {norm.cycle.goal && <div className="muted" style={{ fontSize: 14 }}>{norm.cycle.goal}</div>}
          </div>
          {norm.sectionProgress && (
            <div className="cycle-progress">
              <span className="mono">{norm.sectionProgress.done}/{norm.sectionProgress.total}</span>
              <div className="progress"><div style={{ width: `${norm.sectionProgress.total ? (norm.sectionProgress.done / norm.sectionProgress.total) * 100 : 0}%` }} /></div>
            </div>
          )}
        </div>
      ) : (
        <div className="callout">
          <div>
            Немає активного циклу. <Link href="/cycles" style={{ textDecoration: 'underline' }}>Створи цикл</Link> з розділом матеріалу, і норма дня братиме наступне з нього.
            Поки що вона бере наступну клітинку карти по загальному порядку.
          </div>
        </div>
      )}

      <h2 className="block-title">Норма дня {norm.allDone ? <span className="tag green">день закрито</span> : <span className="faint" style={{ fontWeight: 400, fontSize: 14 }}>{doneCount} готово · {openCount} лишилось</span>}</h2>
      <p className="muted" style={{ fontSize: 14, marginBottom: 10 }}>
        Чотири слоти і картки. Код сам обирає, що далі. Усі закриті = день закритий, навіть якщо є сили: решта в парковку.
      </p>
      <div className="slots">
        {norm.slots.map((slot) => (
          <div key={slot.key} className={`slot${slot.done ? ' done' : ''}${slot.empty && !slot.done ? ' empty' : ''}`}>
            <div className="slot-head">
              <span className={`slot-mark${slot.done ? ' on' : ''}`} aria-hidden="true" />
              <span className="slot-title">{slot.title}</span>
            </div>
            {slot.subject ? (
              <Link href={slot.href} className="slot-subject">{slot.subject}</Link>
            ) : (
              <span className="slot-subject faint">{slot.empty ? 'Порожньо' : ''}</span>
            )}
            <div className="faint" style={{ fontSize: 13 }}>{slot.hint}</div>
            {slot.key === 'spoken' && slot.subjectKey && !slot.done && <SpokenForm subjectKey={slot.subjectKey} />}
            {slot.key !== 'spoken' && slot.subject && !slot.done && (
              <Link href={slot.href} className="btn sm" style={{ alignSelf: 'flex-start' }}>Відкрити</Link>
            )}
          </div>
        ))}
      </div>

      {towers.length > 0 && <TowerCard towers={towers} />}

      {studyPlans.map((studyPlan) => {
        const progress = planProgress(studyPlan);
        const next = progress.next;
        return (
          <div key={studyPlan.source.id} className="callout">
            <div style={{ flex: 1, fontSize: 14 }}>
              <Link href="/plan" style={{ fontWeight: 600 }}>{studyPlan.source.planName}</Link>
              <span className="muted"> · крок {Math.min(progress.done + 1, progress.total)}/{progress.total}</span>
              {next && (
                <>
                  <span className="faint"> · далі: </span>
                  <Link href={stepHref(studyPlan, next)} style={{ textDecoration: 'underline' }}>{next.title}</Link>
                </>
              )}
            </div>
          </div>
        );
      })}

      <h2 className="block-title">Парковка</h2>
      {parking.picked ? (
        <div className="callout">
          <div style={{ flex: 1 }}>
            <span className="lbl">Експеримент цього тижня</span>
            <div>{parking.picked.text}</div>
          </div>
        </div>
      ) : isSunday && parking.open.length > 0 ? (
        <div className="callout">
          <div>Неділя: <Link href="/parking" style={{ textDecoration: 'underline' }}>вибери одне питання</Link> з парковки на експеримент цього тижня ({parking.open.length} чекають).</div>
        </div>
      ) : null}
      <QuickCapture />
      {parking.open.length > 0 && <p className="faint" style={{ fontSize: 13, marginTop: 6 }}>На парковці {parking.open.length}. <Link href="/parking" style={{ textDecoration: 'underline' }}>Переглянути</Link>.</p>}

      <h2 className="block-title">Час</h2>
      <LogTime topics={allTopics} />
    </div>
  );
}
