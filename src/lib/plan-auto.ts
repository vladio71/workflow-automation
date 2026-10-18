import 'server-only';
import { generatePlan } from '@/app/actions';
import { db } from './db';
import { NO_FOCUS } from './day-focus';
import { getFirstStep } from './handoff';
import { DEFAULT_BUDGET, getTodayPlan } from './planner';
import { dayKey } from './queries';

/**
 * Build today's plan with no settings if it does not exist yet: for the morning script and the /mini button.
 * Budget and focus come from yesterday's plan, the wish is the first step from the evening handoff.
 * An existing plan is left untouched.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface EnsurePlanResult {
  created: boolean;
  items: number;
  note: string;
  error: string;
}

export async function ensureTodayPlan(now: Date = new Date()): Promise<EnsurePlanResult> {
  const existing = await getTodayPlan(now);
  if (existing) return { created: false, items: existing.items.length, note: '', error: '' };

  const [yesterday, firstStep] = await Promise.all([
    db.dailyPlan.findUnique({ where: { day: dayKey(new Date(now.getTime() - DAY_MS)) } }),
    getFirstStep(now),
  ]);
  const result = await generatePlan({
    budget: yesterday?.budget || DEFAULT_BUDGET,
    focus: yesterday?.focus ?? NO_FOCUS,
    wish: firstStep ? `Почати з: ${firstStep}` : '',
  });
  if (!result.ok) return { created: false, items: 0, note: '', error: result.error };

  const plan = await getTodayPlan(now);
  return { created: true, items: plan?.items.length ?? 0, note: result.note ?? '', error: '' };
}
