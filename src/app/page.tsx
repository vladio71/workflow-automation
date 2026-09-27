import Link from 'next/link';
import { setDaily } from './actions';
import { CheckItem } from '@/components/CheckItem';
import { PlanCard } from '@/components/PlanCard';
import { LogTime } from '@/components/LogTime';
import { formatMinutes, getAnalytics } from '@/lib/activity';
import { isGeminiConfigured } from '@/lib/gemini';
import { getTodayPlan } from '@/lib/planner';
import { QuickCapture } from '@/components/QuickCapture';
import { AutoSync } from '@/components/AutoSync';
import { Tag } from '@/components/Tag';
import { CONFIDENCES, TRACKS, optionFor } from '@/lib/labels';
import { getActiveCycle, getDueTopics, getNextSystemDesignTopic, getTodayLog } from '@/lib/queries';
import { relativeDay } from '@/lib/schedule';
import { db } from '@/lib/db';
import { getStudyPlans, planProgress, stepHref } from '@/lib/study-plan';

export default async function TodayPage() {
  const now = new Date();
  const [plan, stats, allTopics, log, cycle, due, sdTopic, studyPlans] = await Promise.all([
    getTodayPlan(now),
    getAnalytics(7, now),
    db.topic.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    getTodayLog(now),
    getActiveCycle(),
    getDueTopics(now),
    getNextSystemDesignTopic(),
    getStudyPlans(),
  ]);
  const cycleTodo = cycle
    ? await db.topic.findMany({ where: { cycleId: cycle.id, confidence: { not: 'GREEN' } }, orderBy: { id: 'asc' } })
    : [];

  const dateLabel = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const isSunday = now.getDay() === 0;

  return (
    <div className="page">
      <AutoSync />
      <div className="page-icon">☀️</div>
      <h1 className="page-title">Today</h1>
      <p className="page-sub">
        {dateLabel} · 🔥 {stats.streak.current} day streak · {formatMinutes(stats.todayMinutes)} today · {formatMinutes(stats.weekMinutes)} this week
      </p>

      <PlanCard
        plan={plan ? { summary: plan.summary, review: plan.review, items: plan.items } : null}
        geminiEnabled={isGeminiConfigured()}
      />

      {studyPlans.map((studyPlan) => {
        const progress = planProgress(studyPlan);
        const next = progress.next;
        return (
          <div key={studyPlan.source.id} className="callout">
            <span className="emoji">🧭</span>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <Link href="/plan" style={{ fontWeight: 600 }}>{studyPlan.source.planName}</Link>
                <span className="muted" style={{ fontSize: 13 }}>
                  step {Math.min(progress.done + 1, progress.total)}/{progress.total}{next ? ` · ${next.group}` : ' · done'}
                </span>
              </div>
              <div className="progress" style={{ margin: '8px 0' }}>
                <div style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
              {next ? (
                <div style={{ fontSize: 14 }}>
                  <span className="faint">Next: </span>
                  {stepHref(studyPlan, next).startsWith('http') ? (
                    <a href={stepHref(studyPlan, next)} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>{next.title} ↗</a>
                  ) : (
                    <Link href={stepHref(studyPlan, next)} style={{ textDecoration: 'underline' }}>{next.title}</Link>
                  )}
                  <span className="faint mono"> · {next.minutes}m</span>
                </div>
              ) : (
                <div className="muted" style={{ fontSize: 14 }}>All steps done. Exam mode: a random problem once or twice a week.</div>
              )}
            </div>
          </div>
        );
      })}

      {cycle && (
        <div className="callout">
          <span className="emoji">🔁</span>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <Link href="/cycles" style={{ fontWeight: 600 }}>Cycle {cycle.number} · {cycle.name}</Link>
              <span className="muted" style={{ fontSize: 13 }}>{cycle.greenCount}/{cycle.topicCount} green</span>
            </div>
            <div className="muted" style={{ fontSize: 14, margin: '2px 0 10px' }}>{cycle.goal}</div>
            <div className="progress"><div style={{ width: `${cycle.topicCount ? (cycle.greenCount / cycle.topicCount) * 100 : 0}%` }} /></div>
            <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
              one topic per cycle, finish it before the next
            </div>
          </div>
        </div>
      )}

      <h2 className="block-title">Log time</h2>
      <LogTime topics={allTopics} />

      <h2 className="block-title">Daily · 25 min</h2>
      <CheckItem checked={log.ankiDone} label={<>Anki: 10-15 cards</>} action={setDaily.bind(null, 'ankiDone')} />
      <CheckItem checked={log.recallDone} label={<>1 recall from the list below: blank page, then check</>} action={setDaily.bind(null, 'recallDone')} />
      <CheckItem checked={log.outLoud} label={<>1 question out loud in a minute</>} action={setDaily.bind(null, 'outLoud')} />

      <h2 className="block-title">Due for recall <span className="faint" style={{ fontWeight: 400, fontSize: 15 }}>{due.length}</span></h2>
      <p className="muted" style={{ fontSize: 14, marginBottom: 8 }}>Red first, then the oldest. Pick one, not all.</p>
      {due.length === 0 ? (
        <p className="faint">Nothing due. Work on the cycle.</p>
      ) : (
        <table className="db">
          <thead>
            <tr><th>Aa Name</th><th>Track</th><th>Confidence</th><th>Last recall</th><th></th></tr>
          </thead>
          <tbody>
            {due.slice(0, 12).map((topic) => {
              const track = optionFor(TRACKS, topic.track);
              const confidence = optionFor(CONFIDENCES, topic.confidence);
              return (
                <tr key={topic.id}>
                  <td className="title-cell"><Link href={`/topics/${topic.id}`}>{topic.name}</Link></td>
                  <td><Tag color={track.color}>{track.label}</Tag></td>
                  <td><Tag color={confidence.color}>{confidence.label}</Tag></td>
                  <td className="muted">{relativeDay(topic.lastRecallAt, now) || '—'}</td>
                  <td style={{ width: 90 }}><Link className="btn sm" href={`/recall/${topic.id}`}>Recall →</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {cycleTodo.length > 0 && (
        <>
          <h2 className="block-title">This cycle</h2>
          <table className="db">
            <tbody>
              {cycleTodo.map((topic) => {
                const confidence = optionFor(CONFIDENCES, topic.confidence);
                return (
                  <tr key={topic.id}>
                    <td className="title-cell"><Link href={`/topics/${topic.id}`}>{topic.name}</Link></td>
                    <td style={{ width: 130 }}><Tag color={confidence.color}>{confidence.label}</Tag></td>
                    <td className="muted mono" style={{ width: 220 }}>{topic.drill}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {studyPlans.length === 0 && (<>
      <h2 className="block-title">Weekly · system design</h2>
      <div className="callout">
        <span className="emoji">🏗️</span>
        <div>
          {sdTopic ? (
            <div>This week's primer section: <Link href={`/topics/${sdTopic.id}`} style={{ fontWeight: 500, textDecoration: 'underline' }}>{sdTopic.name.replace(/^SD /, '')}</Link></div>
          ) : (
            <div>Add system design topics to see the next primer section.</div>
          )}
          <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>Read it, do the widgets and quiz, write 3-5 questions, then its drill. Plus 1 mock, 45 min, out loud.</div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <Link className="btn sm" href="/mock">🎙️ Start a mock</Link>
            <a className="btn sm" href="https://systemdesignschool.io/primer" target="_blank" rel="noreferrer">Open primer ↗</a>
          </div>
        </div>
      </div>
      </>)}

      {isSunday && (
        <div className="callout">
          <span className="emoji">🧹</span>
          <div>
            <b>Sunday review, 20 min.</b> Clear the <Link href="/inbox" style={{ textDecoration: 'underline' }}>Inbox</Link>, recolor Topics, write the cycle retro if it ends, pick next week's primer section.
          </div>
        </div>
      )}

      <h2 className="block-title">Quick capture</h2>
      <QuickCapture />
    </div>
  );
}
