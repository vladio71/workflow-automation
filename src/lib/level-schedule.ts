/**
 * Розклад рівнів (вправ live-code). Чиста логіка без БД, як plan-order.ts: так її легко перевірити окремо.
 *
 * Правило з README live-code: пройшов, через 2 дні та сама вправа з нуля. Далі інтервали ростуть, як у тем (2 → 7 → 21 → 42 → 84).
 *   - прохід у термін (або перший прохід) = новий етап, рамка росте: бронза → срібло → золото;
 *   - прохід раніше терміну = тренування, розклад не міняє;
 *   - здався (відкрив еталон до проходження) = повтор через 2 дні, рамка не падає;
 *   - прохід того ж дня після "здався" = рівень на сьогодні закрито, але в рамку не йде.
 */
import { INTERVAL_LADDER, startOfDay } from './schedule';

export type LevelFrame = 'NONE' | 'BRONZE' | 'SILVER' | 'GOLD';

/** NEW = ще не проходив чесно і не пробував; DUE = настав термін; WAITING = термін ще не настав. */
export type LevelStatus = 'NEW' | 'DUE' | 'WAITING';

export interface AttemptFact {
  passed: boolean;
  gaveUp: boolean;
  createdAt: Date;
}

export interface LevelProgress {
  /** скільки проходів у термін: 0 = ще не пройдено чесно */
  stage: number;
  frame: LevelFrame;
  status: LevelStatus;
  /** наступний повтор; null = рівень ще не пробував */
  dueAt: Date | null;
  lastPassedAt: Date | null;
  passedToday: boolean;
  gaveUpToday: boolean;
}

/** здався або пройшов тільки з еталоном: ще раз через 2 дні */
const RETRY_DAYS = 2;

/** календарні дні (setDate), а не 24 год * n: інакше перехід на зимовий час дає 23:00 попереднього дня */
function addDays(date: Date, days: number): Date {
  const copy = startOfDay(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** інтервал після етапу stage (1 = перший прохід): 2, 7, 21, 42, 84, далі 84 */
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
      // перша спроба або повтор у термін: ще раз через 2 дні; під час тренування раніше терміну розклад не чіпаємо
      if (dueAt === null || attempt.createdAt >= dueAt) dueAt = addDays(attempt.createdAt, RETRY_DAYS);
      continue;
    }
    if (!attempt.passed) continue; // червоні тести: просто спроба

    lastPassedAt = attempt.createdAt;
    if (day === today) passedToday = true;
    if (gaveUpOnDay === day) continue; // пройшов уже після еталону: не рахується в рамку

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
