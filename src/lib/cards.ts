import 'server-only';
import type { CardGrade, Question } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { dayKey } from '@/lib/queries';
import { endOfDay, startOfDay } from '@/lib/schedule';

/**
 * Картки (CONCEPT-питання) з власним розкладом, замість Anki.
 *   Згадав (GOOD)  -> наступний інтервал: 1 -> 3 -> 7 -> 14 -> 30 -> 60 -> 120 днів
 *   Важко (HARD)   -> той самий інтервал
 *   Забув (FORGOT) -> знову через 1 день (а в поточній сесії ще раз у кінці)
 * Нові картки приходять поступово: не більше NEW_PER_DAY на день.
 * У режимі "All cards" (PRACTICE) розклад не міняється; "Забув" там теж ставить картку на завтра.
 */

export const CARD_LADDER: readonly number[] = [1, 3, 7, 14, 30, 60, 120];
export const NEW_PER_DAY = 10;
const MAX_SECONDS_PER_CARD = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CardSchedule {
  interval: number;
  dueAt: Date;
}

export function nextCardInterval(current: number, grade: CardGrade): number {
  const first = CARD_LADDER[0] ?? 1;
  if (grade === 'FORGOT') return first;
  if (grade === 'HARD') return Math.max(current, first);
  const next = CARD_LADDER.find((days) => days > current);
  return next ?? CARD_LADDER[CARD_LADDER.length - 1] ?? first;
}

/** Термін = початок дня через interval днів: картка доступна з самого ранку того дня. */
export function scheduleCard(current: number, grade: CardGrade, now: Date): CardSchedule {
  const interval = nextCardInterval(current, grade);
  return { interval, dueAt: new Date(startOfDay(now).getTime() + interval * DAY_MS) };
}

export interface CardView {
  id: number;
  question: string;
  answer: string;
  topicId: number | null;
  topicName: string;
  isNew: boolean;
  dueAt: Date | null;
  interval: number;
  lapses: number;
  /** картка прийшла з репо (learn/questions.md) */
  fromRepo: boolean;
  /** картку з репо змінили в апці: Sync її більше не оновлює */
  editedInApp: boolean;
}

type QuestionWithTopic = Question & { topic: { id: number; name: string } | null };

function toView(question: QuestionWithTopic): CardView {
  return {
    id: question.id,
    question: question.question,
    answer: question.reference || question.myAnswer,
    topicId: question.topic?.id ?? null,
    topicName: question.topic?.name ?? 'No topic',
    isNew: question.cardDueAt === null,
    dueAt: question.cardDueAt,
    interval: question.cardInterval,
    lapses: question.cardLapses,
    fromRepo: question.sourceId !== null,
    editedInApp: question.sourceId !== null && question.editedInApp,
  };
}

export interface CardQueue {
  due: CardView[];
  fresh: CardView[];
  /** скільки нових ще можна взяти сьогодні */
  newLeft: number;
  reviewedToday: number;
}

/** Черга на сьогодні: усі, у кого настав термін (найстаріші першими) + нові в межах ліміту. */
export async function getCardQueue(now: Date = new Date()): Promise<CardQueue> {
  const from = startOfDay(now);
  const [due, newSeenToday, reviewedToday] = await Promise.all([
    db.question.findMany({
      where: { kind: 'CONCEPT', cardDueAt: { lte: endOfDay(now) } },
      include: { topic: { select: { id: true, name: true } } },
      orderBy: { cardDueAt: 'asc' },
    }),
    db.cardReview.count({ where: { wasNew: true, createdAt: { gte: from } } }),
    db.cardReview.count({ where: { grade: { not: 'PRACTICE' }, createdAt: { gte: from } } }),
  ]);
  const newLeft = Math.max(0, NEW_PER_DAY - newSeenToday);
  const fresh =
    newLeft === 0
      ? []
      : await db.question.findMany({
          where: { kind: 'CONCEPT', cardDueAt: null },
          include: { topic: { select: { id: true, name: true } } },
          orderBy: { id: 'asc' },
          take: newLeft,
        });
  return { due: due.map(toView), fresh: fresh.map(toView), newLeft, reviewedToday };
}

/** Для лічильника в сайдбарі і плану дня: скільки карток чекає сьогодні. */
export async function getCardCounts(now: Date = new Date()): Promise<{ due: number; fresh: number }> {
  const queue = await getCardQueue(now);
  return { due: queue.due.length, fresh: queue.fresh.length };
}

/** Усі картки для вільного перегляду: нічого не ховаємо, розклад тут не заважає. */
export async function getAllCards(): Promise<CardView[]> {
  const questions = await db.question.findMany({
    where: { kind: 'CONCEPT' },
    include: { topic: { select: { id: true, name: true } } },
    orderBy: [{ topicId: 'asc' }, { id: 'asc' }],
  });
  return questions.map(toView);
}

/** Одна картка: Telegram-бот перемальовує нею повідомлення після показу відповіді чи оцінки. */
export async function getCard(questionId: number): Promise<CardView | null> {
  const question = await db.question.findUnique({
    where: { id: questionId },
    include: { topic: { select: { id: true, name: true } } },
  });
  return question ? toView(question) : null;
}

export interface ReviewInput {
  questionId: number;
  grade: CardGrade;
  seconds: number;
}

/** Показ картки: запис у журнал, новий розклад (крім PRACTICE), час у Stats одним рядком на день. */
export async function reviewCard(input: ReviewInput, now: Date = new Date()): Promise<void> {
  const question = await db.question.findUniqueOrThrow({ where: { id: input.questionId } });
  const seconds = Math.max(0, Math.min(MAX_SECONDS_PER_CARD, Math.round(input.seconds)));
  const wasNew = question.cardDueAt === null && input.grade !== 'PRACTICE';

  // PRACTICE: розклад не чіпаємо. FORGOT у вільному режимі все одно ставить картку на завтра.
  const changesSchedule = input.grade !== 'PRACTICE';
  const next = changesSchedule ? scheduleCard(question.cardInterval, input.grade, now) : null;

  await db.$transaction([
    db.cardReview.create({ data: { questionId: question.id, grade: input.grade, wasNew, seconds } }),
    ...(next
      ? [
          db.question.update({
            where: { id: question.id },
            data: {
              cardInterval: next.interval,
              cardDueAt: next.dueAt,
              cardReviewedAt: now,
              cardLapses: input.grade === 'FORGOT' ? { increment: 1 } : undefined,
            },
          }),
        ]
      : []),
  ]);
  await syncCardsActivity(now);
}

/** Один запис CARDS в ActivityLog на день, хвилини = сума секунд усіх показів за день. */
async function syncCardsActivity(now: Date): Promise<void> {
  const day = dayKey(now);
  const total = await db.cardReview.aggregate({
    where: { createdAt: { gte: startOfDay(now), lte: endOfDay(now) } },
    _sum: { seconds: true },
  });
  const minutes = Math.round((total._sum.seconds ?? 0) / 60);
  const existing = await db.activityLog.findFirst({ where: { day, kind: 'CARDS' } });
  if (existing) {
    await db.activityLog.update({ where: { id: existing.id }, data: { minutes } });
  } else if (minutes > 0) {
    await db.activityLog.create({ data: { day, kind: 'CARDS', minutes, note: 'cards' } });
  }
}

// ------------------------------------------------------------------ додати / змінити / видалити (All cards)

export interface NewCardInput {
  question: string;
  answer: string;
  topicId: number | null;
}

export interface CardTextInput {
  question: string;
  answer: string;
}

/** Нова картка, зроблена в апці: звичайний рядок Question без sourceId, Sync її не чіпає. Порожнє питання = нічого. */
export async function createCard(input: NewCardInput): Promise<number | null> {
  const question = input.question.trim();
  if (!question) return null;
  const created = await db.question.create({
    data: { kind: 'CONCEPT', question, reference: input.answer.trim(), topicId: input.topicId },
  });
  return created.id;
}

/**
 * Змінити текст картки. Розклад лишається як був.
 * Картка з репо після зміни позначається editedInApp: Sync далі не перезаписує її текст з questions.md.
 * sourceKey не міняємо: за ним Sync упізнає, що картка з репо вже є, і не створює дублікат.
 */
export async function updateCard(id: number, input: CardTextInput): Promise<void> {
  const current = await db.question.findUnique({ where: { id } });
  if (!current) return;
  const question = input.question.trim();
  if (!question) return;
  const answer = input.answer.trim();
  // у формі видно reference, а якщо його нема, то відповідь з пам'яті: незмінений текст не пишемо в reference
  const shownAnswer = current.reference || current.myAnswer;
  // пробіли по краях не рахуються зміною: інакше Save без правок позначив би картку з репо як змінену
  const questionChanged = question !== current.question.trim();
  const answerChanged = answer !== shownAnswer.trim();
  if (!questionChanged && !answerChanged) return;

  // updateMany: якщо картку тим часом видалили (тут чи через Sync), це не помилка
  await db.question.updateMany({
    where: { id },
    data: {
      ...(questionChanged ? { question } : {}),
      ...(answerChanged ? { reference: answer } : {}),
      ...(current.sourceId !== null ? { editedInApp: true } : {}),
    },
  });
}

/**
 * Видалити картку. Для картки з репо лишаємо запис у DeletedCard з її ключем,
 * інакше наступний Sync побачив би її в questions.md і створив знову.
 */
export async function deleteCard(id: number): Promise<void> {
  const current = await db.question.findUnique({ where: { id } });
  if (!current) return;
  const { sourceId, sourceKey } = current;

  if (sourceId === null || sourceKey === null) {
    await db.question.delete({ where: { id } });
    return;
  }
  await db.$transaction([
    db.deletedCard.upsert({
      where: { sourceId_sourceKey: { sourceId, sourceKey } },
      update: { question: current.question },
      create: { sourceId, sourceKey, question: current.question },
    }),
    db.question.delete({ where: { id } }),
  ]);
}
