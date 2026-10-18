/**
 * Schedule of levels (live-code exercises). Pure logic without DB, like plan-order.ts, so it is easy to test on its own.
 *
 * Rule from the live-code README: after a pass, the same exercise from scratch in 2 days. Then intervals grow as for topics (2 -> 7 -> 21 -> 42 -> 84).
 *   - a pass on time (or the first pass) = a new stage, the frame grows: bronze -> silver -> gold;
 *   - a pass before it is due = practice, the schedule is unchanged;
 *   - gave up (opened the reference before passing) = repeat in 2 days, the frame does not drop;
 *   - a pass the same day after giving up = the level is closed for today but does not count toward the frame.
 */
import { INTERVAL_LADDER, startOfDay } from './schedule';

export type LevelFrame = 'NONE' | 'BRONZE' | 'SILVER' | 'GOLD';

/** NEW = never passed honestly or tried; DUE = repeat is due; WAITING = not due yet. */
export type LevelStatus = 'NEW' | 'DUE' | 'WAITING';

export interface AttemptFact {
  passed: boolean;
  gaveUp: boolean;
  createdAt: Date;
}

export interface LevelProgress {
  /** passes on time: 0 = not passed honestly yet */
  stage: number;
  frame: LevelFrame;
  status: LevelStatus;
  /** next repeat; null = level never tried */
  dueAt: Date | null;
  lastPassedAt: Date | null;
  passedToday: boolean;
  gaveUpToday: boolean;
}

/** gave up or passed only with the reference: again in 2 days */
const RETRY_DAYS = 2;

/** calendar days (setDate), not 24 h * n: otherwise a DST switch yields 23:00 of the previous day */
function addDays(date: Date, days: number): Date {
  const copy = startOfDay(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** interval after stage (1 = first pass): 2, 7, 21, 42, 84, then 84 */
function intervalAfterStage(stage: number): number {
  const index = Math.min(stage - 1, INTERVAL_LADDER.length - 1);
  return INTERVAL_LADDER[index] ?? RETRY_DAYS;
}

export function frameFor(stage: number): LevelFrame {
  if (stage >= 3) return 'GOLD';
  if (stage === 2) return 'SILVER';
  if (stage === 1) return 'BRONZE';
  return 'NONE';
}

export function levelProgress(attempts: readonly AttemptFact[], now: Date): LevelProgress {
  const sorted = [...attempts].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const today = startOfDay(now).getTime();

  let stage = 0;
  let dueAt: Date | null = null;
  let lastPassedAt: Date | null = null;
  let gaveUpOnDay: number | null = null;
  let passedToday = false;
  let gaveUpToday = false;

  for (const attempt of sorted) {
    const day = startOfDay(attempt.createdAt).getTime();
    if (attempt.gaveUp) {
      gaveUpOnDay = day;
      if (day === today) gaveUpToday = true;
      // first attempt or a repeat on time: again in 2 days; practice before the due date leaves the schedule alone
      if (dueAt === null || attempt.createdAt >= dueAt) dueAt = addDays(attempt.createdAt, RETRY_DAYS);
      continue;
    }
    if (!attempt.passed) continue; // red tests: just an attempt

    lastPassedAt = attempt.createdAt;
    if (day === today) passedToday = true;
    if (gaveUpOnDay === day) continue; // passed after seeing the reference: does not count toward the frame

    if (stage === 0 || dueAt === null || attempt.createdAt >= dueAt) {
      stage += 1;
      dueAt = addDays(attempt.createdAt, intervalAfterStage(stage));
    }
  }

  let status: LevelStatus = 'NEW';
  if (dueAt !== null) status = now >= dueAt ? 'DUE' : 'WAITING';

  return { stage, frame: frameFor(stage), status, dueAt, lastPassedAt, passedToday, gaveUpToday };
}

export const FRAME_ICON: Record<LevelFrame, string> = { NONE: '', BRONZE: '🥉', SILVER: '🥈', GOLD: '🥇' };
