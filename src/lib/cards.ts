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

/**
 * Скільки днів від сьогодні до дедлайну: 0 = дедлайн сьогодні, від'ємне = минув.
 * deadline це колонка DATE (опівніч UTC), тому порівнюємо з dayKey(now), а не з локальним startOfDay.
 */
export function daysUntilDeadline(deadline: Date, now: Date): number {
  return Math.round((deadline.getTime() - dayKey(now).getTime()) / DAY_MS);
}

/** Підпис дедлайну для UI: "today", "in 3d", "2d ago". */
export function deadlineLabel(deadline: Date, now: Date): string {
  const diff = daysUntilDeadline(deadline, now);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return diff > 0 ? `in ${diff}d` : `${-diff}d ago`;
}

export function deadlineActive(deadline: Date | null, now: Date): deadline is Date {
  return deadline !== null && daysUntilDeadline(deadline, now) >= 0;
}

/**
 * Інтервал до дедлайну: драбина стискається під дату, що лишилась.
 * Кожне наступне повторення приблизно вдвічі довше за попереднє (1, 2, 4, ...), але жодне не перестрибує
 * переддень дедлайну: останній раз картку видно за день до нього. Лишився 1 день або менше: щодня.
 * FORGOT завжди на завтра, HARD повторює поточний крок (мінімум 1).
 */
export function nextDeadlineInterval(current: number, grade: CardGrade, daysLeft: number): number {
  const last = Math.max(1, daysLeft - 1); // переддень дедлайну
  if (grade === 'FORGOT') return 1;
  if (grade === 'HARD') return Math.min(last, Math.max(current, 1));
  const doubled = Math.max(1, current) * 2;
  const next = current === 0 ? 1 : doubled;
  return Math.min(last, next);
}

export function scheduleCardWithDeadline(current: number, grade: CardGrade, now: Date, deadline: Date | null): CardSchedule {
  if (!deadlineActive(deadline, now)) return scheduleCard(current, grade, now);
  const interval = nextDeadlineInterval(current, grade, daysUntilDeadline(deadline, now));
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
  /** дедлайн категорії, якщо він ще не минув: картка в пріоритеті */
  deadline: Date | null;
}

type QuestionWithTopic = Question & { topic: { id: number; name: string; deadline: Date | null } | null };
const TOPIC_SELECT = { select: { id: true, name: true, deadline: true } } as const;

function toView(question: QuestionWithTopic): CardView {
  return {
    id: question.id,
    question: question.question,
    answer: question.reference || question.myAnswer,
    topicId: question.topic?.id ?? null,
    topicName: question.topic?.name ?? NO_CATEGORY_NAME,
    isNew: question.cardDueAt === null,
    dueAt: question.cardDueAt,
    interval: question.cardInterval,
    lapses: question.cardLapses,
    fromRepo: question.sourceId !== null,
    editedInApp: question.sourceId !== null && question.editedInApp,
    deadline: question.topic?.deadline ?? null,
  };
}

/**
 * Порядок черги: спершу категорії з живим дедлайном (ближчий вище), потім решта.
 * Усередині порядок як був: прострочені за терміном, нові за id.
 */
function byDeadlineFirst(now: Date) {
  return (a: CardView, b: CardView): number => {
    const da = deadlineActive(a.deadline, now) ? a.deadline.getTime() : Number.POSITIVE_INFINITY;
    const db_ = deadlineActive(b.deadline, now) ? b.deadline.getTime() : Number.POSITIVE_INFINITY;
    return da - db_;
  };
}

export interface CardQueue {
  due: CardView[];
  fresh: CardView[];
  /**
   * Порядок для Review: усі картки з живим дедлайном (прострочені й нові) попереду,
   * далі звичайні прострочені, далі звичайні нові. Саме цей список показувати, а не [...due, ...fresh].
   */
  review: CardView[];
  /** скільки нових ще можна взяти сьогодні */
  newLeft: number;
  reviewedToday: number;
}

/** Одна категорія карток: тема або "без категорії" (topicId: null). */
export interface CategoryFilter {
  topicId: number | null;
}

/**
 * Черга на сьогодні: усі, у кого настав термін (найстаріші першими) + нові в межах ліміту.
 * З filter у черзі тільки картки однієї категорії; ліміт нових на день лишається спільним.
 */
export async function getCardQueue(now: Date = new Date(), filter?: CategoryFilter): Promise<CardQueue> {
  const from = startOfDay(now);
  const today = dayKey(now); // для колонки DATE (deadline)
  const inCategory = filter ? { topicId: filter.topicId } : {};
  const [due, newSeenToday, reviewedToday, urgentFresh] = await Promise.all([
    db.question.findMany({
      where: { kind: 'CONCEPT', cardDueAt: { lte: endOfDay(now) }, ...inCategory },
      include: { topic: TOPIC_SELECT },
      orderBy: { cardDueAt: 'asc' },
    }),
    // нові картки категорій з дедлайном у ліміт не входять, інакше вони з'їли б денну норму звичайних
    db.cardReview.count({
      where: {
        wasNew: true,
        createdAt: { gte: from },
        OR: [{ question: { topicId: null } }, { question: { topic: { deadline: null } } }, { question: { topic: { deadline: { lt: today } } } }],
      },
    }),
    db.cardReview.count({ where: { grade: { not: 'PRACTICE' }, createdAt: { gte: from } } }),
    // нові картки категорій з дедлайном: усі одразу, ліміт на день для них не діє
    db.question.findMany({
      where: { kind: 'CONCEPT', cardDueAt: null, topic: { deadline: { gte: today } }, ...inCategory },
      include: { topic: TOPIC_SELECT },
      orderBy: { id: 'asc' },
    }),
  ]);
  const newLeft = Math.max(0, NEW_PER_DAY - newSeenToday);
  const regularFresh =
    newLeft === 0
      ? []
      : await db.question.findMany({
          where: {
            kind: 'CONCEPT',
            cardDueAt: null,
            OR: [{ topicId: null }, { topic: { deadline: null } }, { topic: { deadline: { lt: today } } }],
            ...inCategory,
          },
          include: { topic: TOPIC_SELECT },
          orderBy: { id: 'asc' },
          take: newLeft,
        });
  const order = byDeadlineFirst(now);
  const dueViews = due.map(toView).sort(order);
  const freshViews = [...urgentFresh.map(toView), ...regularFresh.map(toView)].sort(order);
  const isUrgent = (card: CardView): boolean => deadlineActive(card.deadline, now);
  const review = [
    ...[...dueViews.filter(isUrgent), ...freshViews.filter(isUrgent)].sort(order),
    ...dueViews.filter((card) => !isUrgent(card)),
    ...freshViews.filter((card) => !isUrgent(card)),
  ];
  return { due: dueViews, fresh: freshViews, review, newLeft, reviewedToday };
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
    include: { topic: TOPIC_SELECT },
    orderBy: [{ topicId: 'asc' }, { id: 'asc' }],
  });
  return questions.map(toView);
}

/** Одна картка: Telegram-бот перемальовує нею повідомлення після показу відповіді чи оцінки. */
export async function getCard(questionId: number): Promise<CardView | null> {
  const question = await db.question.findUnique({
    where: { id: questionId },
    include: { topic: TOPIC_SELECT },
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
  const question = await db.question.findUniqueOrThrow({
    where: { id: input.questionId },
    include: { topic: { select: { deadline: true } } },
  });
  const seconds = Math.max(0, Math.min(MAX_SECONDS_PER_CARD, Math.round(input.seconds)));
  const wasNew = question.cardDueAt === null && input.grade !== 'PRACTICE';

  // PRACTICE: розклад не чіпаємо. FORGOT у вільному режимі все одно ставить картку на завтра.
  // Категорія з дедлайном: стиснута драбина; після дедлайну картка живе за звичайною.
  const changesSchedule = input.grade !== 'PRACTICE';
  const next = changesSchedule
    ? scheduleCardWithDeadline(question.cardInterval, input.grade, now, question.topic?.deadline ?? null)
    : null;

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
  if (question.topicId !== null) await touchCategory(question.topicId, now);
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
  if (input.topicId !== null) await touchCategory(input.topicId);
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

// ------------------------------------------------------------------ категорії карток

/**
 * Категорія картки = її тема (Topic). Окремої таблиці нема: картки з репо вже розкладені по темах,
 * а картці, доданій руками, тему вибираєш сам (або створюєш нову прямо у виборі).
 */
export interface CardCategory {
  /** null = картки без категорії */
  id: number | null;
  name: string;
  total: number;
  /** термін настав (сьогодні або раніше) */
  due: number;
  /** ще жодного разу не показані */
  fresh: number;
  /** найраніший термін серед уже показаних карток: коли категорія наступного разу стане due */
  nextDueAt: Date | null;
  /** живий дедлайн категорії: вона йде першою і повторюється частіше */
  deadline: Date | null;
}

export const NO_CATEGORY_NAME = 'No category';

/** Категорії, в яких є картки, з лічильниками. Спершу ті, де є що повторювати, далі за назвою. */
export async function getCardCategories(now: Date = new Date()): Promise<CardCategory[]> {
  const until = endOfDay(now);
  const questions = await db.question.findMany({
    where: { kind: 'CONCEPT' },
    select: { topicId: true, cardDueAt: true, topic: { select: { name: true, deadline: true } } },
  });
  const byKey = new Map<string, CardCategory>();
  for (const question of questions) {
    const key = String(question.topicId);
    let category = byKey.get(key);
    if (!category) {
      const deadline = question.topic?.deadline ?? null;
      category = {
        id: question.topicId,
        name: question.topic?.name ?? NO_CATEGORY_NAME,
        total: 0,
        due: 0,
        fresh: 0,
        nextDueAt: null,
        deadline: deadlineActive(deadline, now) ? deadline : null,
      };
      byKey.set(key, category);
    }
    category.total += 1;
    const dueAt = question.cardDueAt;
    if (dueAt === null) {
      category.fresh += 1;
      continue;
    }
    if (dueAt <= until) category.due += 1;
    if (category.nextDueAt === null || dueAt < category.nextDueAt) category.nextDueAt = dueAt;
  }
  return [...byKey.values()].sort((a, b) => {
    const da = a.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
    const db_ = b.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
    if (da !== db_) return da - db_;
    const byDue = Number(b.due > 0) - Number(a.due > 0);
    if (byDue !== 0) return byDue;
    return a.name.localeCompare(b.name);
  });
}

export interface CategoryChoice {
  id: number;
  name: string;
}

/** Усі теми для вибору категорії: спершу ті, якими користувався останніми, решта за назвою. */
export async function getCategoryChoices(): Promise<CategoryChoice[]> {
  const topics = await db.topic.findMany({ select: { id: true, name: true, cardsUsedAt: true } });
  return topics
    .sort((a, b) => {
      const byUse = (b.cardsUsedAt?.getTime() ?? 0) - (a.cardsUsedAt?.getTime() ?? 0);
      if (byUse !== 0) return byUse;
      return a.name.localeCompare(b.name);
    })
    .map((topic) => ({ id: topic.id, name: topic.name }));
}

/** Категорією щойно користувались: вона піднімається нагору у виборі. */
export async function touchCategory(topicId: number, now: Date = new Date()): Promise<void> {
  await db.topic.updateMany({ where: { id: topicId }, data: { cardsUsedAt: now } });
}

const MAX_CATEGORY_NAME = 120;

/** Нова категорія = нова тема (трек Other). Якщо тема з такою назвою вже є, беремо її, а не робимо дублікат. */
export async function createCategory(name: string): Promise<CategoryChoice | null> {
  const text = name.trim().slice(0, MAX_CATEGORY_NAME);
  if (!text) return null;
  const existing = await db.topic.findFirst({ where: { name: { equals: text, mode: 'insensitive' } } });
  if (existing) {
    await touchCategory(existing.id);
    return { id: existing.id, name: existing.name };
  }
  const created = await db.topic.create({ data: { name: text, track: 'OTHER', cardsUsedAt: new Date() } });
  return { id: created.id, name: created.name };
}

/**
 * Змінити категорію картки. Тільки для карток, доданих в апці:
 * категорію картки з репо задає папка в learn/, і Sync повернув би її назад.
 */
export async function setCardCategory(id: number, topicId: number | null): Promise<boolean> {
  const current = await db.question.findUnique({ where: { id } });
  if (!current || current.sourceId !== null) return false;
  await db.question.update({ where: { id }, data: { topicId } });
  if (topicId !== null) await touchCategory(topicId);
  return true;
}

/** Дедлайн категорії зі сторінки категорії. null = прибрати. Дата без часу (день дедлайну включно). */
export async function setCategoryDeadline(topicId: number, deadline: Date | null): Promise<void> {
  await db.topic.update({ where: { id: topicId }, data: { deadline } });
}
