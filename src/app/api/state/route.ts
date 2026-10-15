import { rejectUnlessAutomation } from '@/lib/automation';
import { getFirstStep, handoffDay } from '@/lib/handoff';
import { getTodayPlan } from '@/lib/planner';
import { dayKey } from '@/lib/queries';
import { db } from '@/lib/db';

/**
 * Стан дня для скриптів на комп'ютері (desk.py, блокер): чи день почато, скільки пунктів закрито,
 * перший крок на сьогодні з вечірньої передачі. Тільки з токеном (x-automation-token).
 */

export interface DayState {
  /** YYYY-MM-DD за часом апки */
  day: string;
  /** план на сьогодні складено */
  planned: boolean;
  /** натиснуто "Start the day" */
  started: boolean;
  done: number;
  total: number;
  /** день почато і всі пункти закриті: блокер може відпустити до вечора */
  allDone: boolean;
  /** "сьогодні починаю з" (записано вчора ввечері), '' якщо нема */
  firstStep: string;
  /** що вже записано на наступний день (після Ctrl+Pause), '' якщо нема */
  nextFirstStep: string;
}

function isoDay(day: Date): string {
  return day.toISOString().slice(0, 10);
}

export async function GET(request: Request): Promise<Response> {
  const rejected = rejectUnlessAutomation(request);
  if (rejected) return rejected;

  const now = new Date();
  const [plan, firstStep, next] = await Promise.all([
    getTodayPlan(now),
    getFirstStep(now),
    db.handoff.findUnique({ where: { day: handoffDay(now) } }),
  ]);
  const total = plan ? plan.items.length : 0;
  const done = plan ? plan.items.filter((item) => item.done).length : 0;
  const started = plan !== null && plan.startedAt !== null;

  const state: DayState = {
    day: isoDay(dayKey(now)),
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
