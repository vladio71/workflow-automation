import 'server-only';
import type { CardGrade, Question } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { dayKey } from '@/lib/queries';
import { endOfDay, startOfDay } from '@/lib/schedule';

/**
 * Cards (CONCEPT questions) with their own schedule, instead of Anki.
 *   Recalled (GOOD)  -> next interval: 1 -> 3 -> 7 -> 14 -> 30 -> 60 -> 120 days
 *   Hard (HARD)      -> the same interval again
 *   Forgot (FORGOT)  -> again in 1 day (and once more at the end of the current session)
 * New cards arrive gradually, at most NEW_PER_DAY per day.
 * In "All cards" mode (PRACTICE) the schedule does not change; "Forgot" there still puts the card on tomorrow.
 *
 * Sections: scheduling rules, today's queue, reviewing a card, editing cards, categories.
 */

// ─── Scheduling rules ────────────────────────────────────────────────────────

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

/** Due = start of the day `interval` days ahead, so the card is available from the morning of that day. */
export function scheduleCard(current: number, grade: CardGrade, now: Date): CardSchedule {
  const interval = nextCardInterval(current, grade);
  return { interval, dueAt: new Date(startOfDay(now).getTime() + interval * DAY_MS) };
}

/**
 * Days from today to the deadline: 0 = today, negative = passed.
 * `deadline` is a DATE column (midnight UTC), so it is compared with dayKey(now), not the local startOfDay.
 */
export function daysUntilDeadline(deadline: Date, now: Date): number {
  return Math.round((deadline.getTime() - dayKey(now).getTime()) / DAY_MS);
}

/** Deadline label for the UI: "today", "in 3d", "2d ago". */
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
 * Interval under a deadline: the ladder is squeezed into the days left.
 * Each review is roughly twice as far as the previous one (1, 2, 4, ...), but none jumps past the day
 * before the deadline, so the card is seen one last time the day before. With 1 day or less left: daily.
 * FORGOT is always tomorrow, HARD repeats the current step (at least 1).
 */
export function nextDeadlineInterval(current: number, grade: CardGrade, daysLeft: number): number {
  const last = Math.max(1, daysLeft - 1);
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

// ─── Today's queue ───────────────────────────────────────────────────────────

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
  /** The card came from a repo (learn/questions.md). */
  fromRepo: boolean;
  /** A repo card edited in the app: Sync no longer overwrites it. */
  editedInApp: boolean;
  /** The category deadline while it has not passed: the card gets priority. */
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

/** Categories with a live deadline first (nearest on top), then the rest; within a group the order is kept. */
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
   * The order for Review: every card with a live deadline (due and new) first, then regular due,
   * then regular new. This is the list to show, not [...due, ...fresh].
   */
  review: CardView[];
  /** How many new cards can still be taken today. */
  newLeft: number;
  reviewedToday: number;
}

/** One card category: a topic, or "no category" (topicId: null). */
export interface CategoryFilter {
  topicId: number | null;
}

interface QueueRows {
  due: QuestionWithTopic[];
  urgentFresh: QuestionWithTopic[];
  regularFresh: QuestionWithTopic[];
  newLeft: number;
  reviewedToday: number;
}

/**
 * Today's queue: everything that is due (oldest first) plus new cards within the daily limit.
 * With a filter only one category is in the queue; the daily limit of new cards stays shared.
 */
export async function getCardQueue(now: Date = new Date(), filter?: CategoryFilter): Promise<CardQueue> {
  const rows = await loadQueueRows(now, filter);
  return orderQueue(rows, now);
}

async function loadQueueRows(now: Date, filter?: CategoryFilter): Promise<QueueRows> {
  const from = startOfDay(now);
  const today = dayKey(now);
  const inCategory = filter ? { topicId: filter.topicId } : {};
  // Deadline categories are outside the daily limit: their new cards must not eat the regular quota.
  const outsideDeadline = [{ topicId: null }, { topic: { deadline: null } }, { topic: { deadline: { lt: today } } }];

  const [due, newSeenToday, reviewedToday, urgentFresh] = await Promise.all([
    db.question.findMany({
      where: { kind: 'CONCEPT', cardDueAt: { lte: endOfDay(now) }, ...inCategory },
      include: { topic: TOPIC_SELECT },
      orderBy: { cardDueAt: 'asc' },
    }),
    db.cardReview.count({
      where: {
        wasNew: true,
        createdAt: { gte: from },
        OR: [{ question: { topicId: null } }, { question: { topic: { deadline: null } } }, { question: { topic: { deadline: { lt: today } } } }],
      },
    }),
    db.cardReview.count({ where: { grade: { not: 'PRACTICE' }, createdAt: { gte: from } } }),
    db.question.findMany({
      where: { kind: 'CONCEPT', cardDueAt: null, topic: { deadline: { gte: today } }, ...inCategory },
      include: { topic: TOPIC_SELECT },
      orderBy: { id: 'asc' },
    }),
  ]);
  const newLeft = Math.max(0, NEW_PER_DAY - newSeenToday);
  const regularFresh = newLeft === 0
    ? []
    : await db.question.findMany({
        where: { kind: 'CONCEPT', cardDueAt: null, OR: outsideDeadline, ...inCategory },
        include: { topic: TOPIC_SELECT },
        orderBy: { id: 'asc' },
        take: newLeft,
      });
  return { due, urgentFresh, regularFresh, newLeft, reviewedToday };
}

function orderQueue(rows: QueueRows, now: Date): CardQueue {
  const order = byDeadlineFirst(now);
  const due = rows.due.map(toView).sort(order);
  const fresh = [...rows.urgentFresh.map(toView), ...rows.regularFresh.map(toView)].sort(order);
  const isUrgent = (card: CardView): boolean => deadlineActive(card.deadline, now);
  const review = [
    ...[...due.filter(isUrgent), ...fresh.filter(isUrgent)].sort(order),
    ...due.filter((card) => !isUrgent(card)),
    ...fresh.filter((card) => !isUrgent(card)),
  ];
  return { due, fresh, review, newLeft: rows.newLeft, reviewedToday: rows.reviewedToday };
}

/** For the sidebar counter and the day plan: how many cards wait today. */
export async function getCardCounts(now: Date = new Date()): Promise<{ due: number; fresh: number }> {
  const queue = await getCardQueue(now);
  return { due: queue.due.length, fresh: queue.fresh.length };
}

/** Every card for free browsing; the schedule does not hide anything here. */
export async function getAllCards(): Promise<CardView[]> {
  const questions = await db.question.findMany({
    where: { kind: 'CONCEPT' },
    include: { topic: TOPIC_SELECT },
    orderBy: [{ topicId: 'asc' }, { id: 'asc' }],
  });
  return questions.map(toView);
}

/** One card: the Telegram bot redraws its message with it after showing the answer or taking a grade. */
export async function getCard(questionId: number): Promise<CardView | null> {
  const question = await db.question.findUnique({
    where: { id: questionId },
    include: { topic: TOPIC_SELECT },
  });
  return question ? toView(question) : null;
}

// ─── Reviewing a card ────────────────────────────────────────────────────────

export interface ReviewInput {
  questionId: number;
  grade: CardGrade;
  seconds: number;
}

/** A card shown: log it, reschedule (except PRACTICE), and roll the time into one Stats row per day. */
export async function reviewCard(input: ReviewInput, now: Date = new Date()): Promise<void> {
  const question = await db.question.findUniqueOrThrow({
    where: { id: input.questionId },
    include: { topic: { select: { deadline: true } } },
  });
  const seconds = Math.max(0, Math.min(MAX_SECONDS_PER_CARD, Math.round(input.seconds)));
  const wasNew = question.cardDueAt === null && input.grade !== 'PRACTICE';

  // PRACTICE leaves the schedule alone. A deadline category uses the squeezed ladder; after the deadline the regular one.
  const next = input.grade === 'PRACTICE'
    ? null
    : scheduleCardWithDeadline(question.cardInterval, input.grade, now, question.topic?.deadline ?? null);

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

/** One CARDS row in ActivityLog per day; minutes = the sum of seconds of every review that day. */
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

// ─── Editing cards (All cards) ───────────────────────────────────────────────

export interface NewCardInput {
  question: string;
  answer: string;
  topicId: number | null;
}

export interface CardTextInput {
  question: string;
  answer: string;
}

/** A card made in the app: a plain Question row without sourceId, which Sync never touches. Empty question = nothing. */
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
 * Change a card's text; the schedule stays. A repo card is marked editedInApp so Sync stops overwriting
 * its text from questions.md. sourceKey is kept: it is how Sync knows the card already exists.
 */
export async function updateCard(id: number, input: CardTextInput): Promise<void> {
  const current = await db.question.findUnique({ where: { id } });
  if (!current) return;
  const question = input.question.trim();
  if (!question) return;
  const answer = input.answer.trim();
  // The form shows the reference, or the answer from memory when there is none; unchanged text is not written into reference.
  const shownAnswer = current.reference || current.myAnswer;
  // Surrounding whitespace is not a change, otherwise Save without edits would mark a repo card as edited.
  const questionChanged = question !== current.question.trim();
  const answerChanged = answer !== shownAnswer.trim();
  if (!questionChanged && !answerChanged) return;

  // updateMany: a card deleted in the meantime (here or by Sync) is not an error.
  await db.question.updateMany({
    where: { id },
    data: {
      ...(questionChanged ? { question } : {}),
      ...(answerChanged ? { reference: answer } : {}),
      ...(current.sourceId !== null ? { editedInApp: true } : {}),
    },
  });
}

/** Delete a card. A repo card leaves a DeletedCard row with its key, otherwise the next Sync would recreate it. */
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

// ─── Categories ──────────────────────────────────────────────────────────────

/**
 * A card's category is its Topic; there is no separate table. Repo cards are already grouped by topic,
 * a card added by hand gets a topic picked (or created) in the chooser.
 */
export interface CardCategory {
  /** null = cards without a category */
  id: number | null;
  name: string;
  total: number;
  /** Due today or earlier. */
  due: number;
  /** Never shown yet. */
  fresh: number;
  /** The earliest due date among shown cards: when the category becomes due next. */
  nextDueAt: Date | null;
  /** A live category deadline: it goes first and repeats more often. */
  deadline: Date | null;
}

export const NO_CATEGORY_NAME = 'No category';

/** Categories that have cards, with counters. Those with something due first, then by name. */
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

/** Every topic for the category chooser: recently used first, the rest by name. */
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

/** The category was just used: it moves to the top of the chooser. */
export async function touchCategory(topicId: number, now: Date = new Date()): Promise<void> {
  await db.topic.updateMany({ where: { id: topicId }, data: { cardsUsedAt: now } });
}

const MAX_CATEGORY_NAME = 120;

/** A new category is a new topic (track Other). An existing topic with the same name is reused, not duplicated. */
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

/** Change a card's category. App-made cards only: a repo card's category is its folder in learn/, and Sync would put it back. */
export async function setCardCategory(id: number, topicId: number | null): Promise<boolean> {
  const current = await db.question.findUnique({ where: { id } });
  if (!current || current.sourceId !== null) return false;
  await db.question.update({ where: { id }, data: { topicId } });
  if (topicId !== null) await touchCategory(topicId);
  return true;
}

/** Category deadline from the category page. null = remove. A date without time; the deadline day is inclusive. */
export async function setCategoryDeadline(topicId: number, deadline: Date | null): Promise<void> {
  await db.topic.update({ where: { id: topicId }, data: { deadline } });
}
