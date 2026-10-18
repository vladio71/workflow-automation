import { rejectUnlessAutomation } from '@/lib/automation';
import { DAY_MS, LATE_NIGHT_HOUR, getFirstStep, handoffDay } from '@/lib/handoff';
import { getTodayPlan } from '@/lib/planner';
import { dayKey } from '@/lib/queries';
import { db } from '@/lib/db';

/**
 * Day state for the scripts on the machine (desk.py, blocker): whether the day is started, how many items
 * are done, today's first step from the evening handoff. Requires the token (x-automation-token).
 *
 * Late night (before LATE_NIGHT_HOUR): if today has no plan yet and yesterday's was started, yesterday's is returned,
 * so the last item closed at 01:00 yields allDone for that day and the blocker sees the moment it closed.
 */

export interface DayState {
  /** YYYY-MM-DD in app time: the plan day this reports on (before 5:00 it may be yesterday) */
  day: string;
  /** today's plan exists */
  planned: boolean;
  /** "Start the day" was pressed */
  started: boolean;
  done: number;
  total: number;
  /** day started and every item done: the blocker may let go until the evening */
  allDone: boolean;
  /** "today I start with" (written the evening before), '' if none */
  firstStep: string;
  /** what is already written for the next day (after Ctrl+Pause), '' if none */
  nextFirstStep: string;
}

function isoDay(day: Date): string {
  return day.toISOString().slice(0, 10);
}

export async function GET(request: Request): Promise<Response> {
  const rejected = rejectUnlessAutomation(request);
  if (rejected) return rejected;

  const now = new Date();
  let planDay = now;
  let plan = await getTodayPlan(now);
  if (plan === null && now.getHours() < LATE_NIGHT_HOUR) {
    const yesterday = new Date(now.getTime() - DAY_MS);
    const prev = await getTodayPlan(yesterday);
    if (prev !== null && prev.startedAt !== null) {
      plan = prev;
      planDay = yesterday;
    }
  }
  const [firstStep, next] = await Promise.all([
    getFirstStep(now),
    db.handoff.findUnique({ where: { day: handoffDay(now) } }),
  ]);
  const total = plan ? plan.items.length : 0;
  const done = plan ? plan.items.filter((item) => item.done).length : 0;
  const started = plan !== null && plan.startedAt !== null;

  const state: DayState = {
    day: isoDay(dayKey(planDay)),
    planned: plan !== null,
    started,
    done,
    total,
    allDone: started && total > 0 && done === total,
    firstStep,
    nextFirstStep: next?.firstStep ?? '',
  };
  return Response.json(state, { headers: { 'cache-control': 'no-store' } });
}
