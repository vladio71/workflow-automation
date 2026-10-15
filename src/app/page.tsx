import Link from 'next/link';
import { DailyList } from '@/components/DailyList';
import { CategoryTable } from '@/components/CategoryTable';
import { PlanCard } from '@/components/PlanCard';
import { LogTime } from '@/components/LogTime';
import { formatMinutes, getAnalytics } from '@/lib/activity';
import { isGeminiConfigured } from '@/lib/gemini';
import { DEFAULT_BUDGET, buildCandidates, getTodayPlan } from '@/lib/planner';
import { addableCandidates } from '@/lib/plan-order';
import { scanLevels } from '@/lib/levels';
import { getTowers } from '@/lib/task-sessions';
import { buildCampaign } from '@/lib/campaign';
import { TowerCard } from '@/components/TowerCard';
import { CampaignStrip } from '@/components/CampaignMap';
import { LEVELS_FOCUS, planFocus, type FocusOption } from '@/lib/day-focus';
import { QuickCapture } from '@/components/QuickCapture';
import { AutoSync } from '@/components/AutoSync';
import { Tag } from '@/components/Tag';
import { CONFIDENCES, optionFor } from '@/lib/labels';
import { getActiveCycle, getNextSystemDesignTopic } from '@/lib/queries';
import { getCardCategories, getCardQueue } from '@/lib/cards';
import { getDailyItems } from '@/lib/daily';
import { getFirstStep } from '@/lib/handoff';
import { db } from '@/lib/db';
import { getStudyPlans, planProgress, stepHref } from '@/lib/study-plan';

export default async function TodayPage() {
  const now = new Date();
  const [plan, stats, allTopics, dailyItems, cycle, cardCategories, cardQueue, sdTopic, studyPlans, levelScan, towers, firstStep] = await Promise.all([
    getTodayPlan(now),
    getAnalytics(7, now),
    db.topic.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    getDailyItems(now),
    getActiveCycle(),
    getCardCategories(now),
    getCardQueue(now),
    getNextSystemDesignTopic(),
    getStudyPlans(),
    scanLevels(),
    getTowers(now),
    getFirstStep(now),
  ]);
  const cycleTodo = cycle
    ? await db.topic.findMany({ where: { cycleId: cycle.id, confidence: { not: 'GREEN' } }, orderBy: { id: 'asc' } })
    : [];
  // у чернетку можна додати те, що план не взяв: кандидати з тим самим фокусом і бюджетом
  const addable = plan && plan.startedAt === null
    ? addableCandidates(plan.items, await buildCandidates(now, { focus: plan.focus, budget: plan.budget || DEFAULT_BUDGET }))
        .map((candidate) => ({ id: candidate.id, kind: candidate.kind, title: candidate.title, minutes: candidate.defaultMinutes }))
    : [];
  // у фокус можна взяти рівні live-code (якщо LEVELS_DIR налаштований) або будь-який навчальний план
  const focusOptions: FocusOption[] = [
    ...(levelScan.levels.length > 0 ? [{ key: LEVELS_FOCUS, name: 'Live code' }] : []),
    ...studyPlans.map((studyPlan) => ({
      key: planFocus(studyPlan.source.id),
      // "System design · 4 тижні + екзамен" -> "System design"
      name: (studyPlan.source.planName || studyPlan.source.repo).split(' · ')[0] ?? studyPlan.source.repo,
    })),
  ];

  // Due for recall: категорії, де сьогодні є що повторювати (термін настав або ще лишились нові в межах ліміту на день)
  const dueCategories = cardCategories.filter((category) => category.due > 0 || (category.fresh > 0 && cardQueue.newLeft > 0));
  const dueCards = cardQueue.due.length + cardQueue.fresh.length;

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

      {firstStep && (
        <div className="callout" style={{ margin: '0 0 14px' }}>
          <span className="emoji">▶️</span>
          <div>
            <div className="faint" style={{ fontSize: 12 }}>Починаю з (записано вчора ввечері)</div>
            <div style={{ fontWeight: 600 }}>{firstStep}</div>
          </div>
        </div>
      )}

      <PlanCard
        plan={plan ? {
          summary: plan.summary,
          review: plan.review,
          items: plan.items,
          started: plan.startedAt !== null,
          focus: plan.focus,
          wish: plan.wish,
          budget: plan.budget,
          aiError: plan.aiError,
        } : null}
        geminiEnabled={isGeminiConfigured()}
        focusOptions={focusOptions}
        addable={addable}
      />

      {towers.length > 0 ? (
        <TowerCard towers={towers} />
      ) : (
        <p className="faint" style={{ fontSize: 13, margin: '6px 2px 0' }}>
          🏰 Башта дня з&apos;явиться, коли в <Link href="/tasks" style={{ textDecoration: 'underline' }}>Tasks</Link> поставиш справі ціль на день, наприклад «Розіслати резюме: 10».
        </p>
      )}

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
              <CampaignStrip campaign={buildCampaign(studyPlan, now)} />
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

      <h2 className="block-title">Daily</h2>
      <DailyList items={dailyItems} />

      <h2 className="block-title">Due for recall <span className="faint" style={{ fontWeight: 400, fontSize: 15 }}>{dueCards}</span></h2>
      <p className="muted" style={{ fontSize: 14, marginBottom: 8 }}>
        Cards by category. A card lands here when its own timer runs out: the grade you give it (forgot, hard, remembered) sets the next date.
      </p>
      {dueCategories.length === 0 ? (
        <p className="faint">Nothing due. <Link href="/cards?tab=categories" style={{ textDecoration: 'underline' }}>All categories</Link>.</p>
      ) : (
        <CategoryTable categories={dueCategories} newLeft={cardQueue.newLeft} now={now} />
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
