import { Prisma } from '@/generated/prisma/client';
import type { TelegramDelivery } from '@/generated/prisma/client';
import type { TelegramDeliveryStatus } from '@/generated/prisma/enums';
import { getCard, getCardQueue, reviewCard, type CardView } from '@/lib/cards';
import { db } from '@/lib/db';
import { dayKey } from '@/lib/queries';
import type { BotConfig } from './config';
import {
  GRADE_LABELS,
  STALE_FOOTER,
  answerText,
  doneText,
  gradeKeyboard,
  gradedFooter,
  helpText,
  parseCallback,
  parseCommand,
  questionText,
  revealKeyboard,
  setupText,
  type BotGrade,
} from './format';
import { TelegramError, type TelegramClient, type TgCallbackQuery, type TgMessage, type TgUpdate } from './telegram';

/**
 * Card bot: a second client to the same schedule as the Cards page.
 *   - at TELEGRAM_SEND_AT sends the first card from today's queue (getCardQueue), the next one after grading;
 *   - "Show answer", then Forgot / Hard / Good -> reviewCard, as in the app;
 *   - TelegramDelivery with UNIQUE (questionId, day): a card never arrives twice a day, even after a restart
 *     or with two bots running; a repeated press or a redelivered update does not record the grade twice;
 *   - one open (ungraded) card per chat: the next one comes only after grading.
 */

const OPEN_STATUSES: TelegramDeliveryStatus[] = ['SENT', 'REVEALED'];
/** an empty queue is rechecked no more often than this: Sync may add cards */
const EMPTY_QUEUE_RECHECK_MS = 15 * 60 * 1000;
const RETRY_AFTER_ERROR_MS = 60 * 1000;
/** arbitrary number: namespace for pg_advisory_xact_lock, so it never collides with other locks */
const CLAIM_LOCK_NAMESPACE = 7201;

/** sent: delivered; empty: nothing left today; taken: an open card already exists (or another bot process just took it) */
type SendResult = 'sent' | 'empty' | 'taken';

function logEditError(error: unknown): void {
  console.error('edit failed:', error);
}

interface MessageRef {
  chatId: string;
  messageId: number;
}

export class CardBot {
  private readonly tg: TelegramClient;
  private readonly config: BotConfig;
  /** dayKey().getTime() of the day whose sending has started: avoids a DB query every cycle */
  private startedDay: number | null = null;
  private nextCheckAt = 0;

  constructor(tg: TelegramClient, config: BotConfig) {
    this.tg = tg;
    this.config = config;
  }

  /** Every polling cycle: after TELEGRAM_SEND_AT start the day with the first card if nothing was sent today. */
  async tick(now: Date): Promise<void> {
    const chatId = this.config.chatId;
    if (!chatId) return;
    if (now.getHours() * 60 + now.getMinutes() < this.config.sendAtMinutes) return;
    const day = dayKey(now);
    if (this.startedDay === day.getTime() || now.getTime() < this.nextCheckAt) return;

    const deliveredToday = await db.telegramDelivery.count({ where: { day, chatId } });
    if (deliveredToday > 0) {
      this.startedDay = day.getTime();
      return;
    }
    // if Telegram or the DB is down right now, retry in a minute rather than every cycle
    this.nextCheckAt = now.getTime() + RETRY_AFTER_ERROR_MS;
    const result = await this.sendNext(chatId, now);
    if (result === 'empty') this.nextCheckAt = now.getTime() + EMPTY_QUEUE_RECHECK_MS;
    else this.startedDay = day.getTime();
  }

  async handleUpdate(update: TgUpdate, now: Date): Promise<void> {
    if (update.callback_query) await this.onCallback(update.callback_query, now);
    else if (update.message) await this.onMessage(update.message, now);
  }

  // ---------- commands ----------

  private async onMessage(message: TgMessage, now: Date): Promise<void> {
    const chatId = String(message.chat.id);
    const command = parseCommand(message.text);
    if (!this.config.chatId) {
      if (command === '/start') await this.tg.sendMessage({ chatId, text: setupText(chatId) });
      return;
    }
    if (chatId !== this.config.chatId) return; // other chats are silently ignored
    if (command === '/today') await this.today(chatId, now);
    else if (command === '/start' || command === '/help') await this.tg.sendMessage({ chatId, text: helpText(this.config.sendAt) });
  }

  /** An open card for today exists -> resend it at the bottom of the chat; none -> the next one from the queue. */
  private async today(chatId: string, now: Date): Promise<void> {
    const open = await db.telegramDelivery.findFirst({
      where: { day: dayKey(now), chatId, status: { in: OPEN_STATUSES }, messageId: { not: null } },
      orderBy: { sentAt: 'desc' },
    });
    if (open && !(await this.isStale(open))) {
      await this.resend(open);
      return;
    }
    if (open) await this.markStale(open.id);
    await this.continueDay(chatId, now);
  }

  private async resend(delivery: TelegramDelivery): Promise<void> {
    const card = await getCard(delivery.questionId);
    if (!card) return;
    const revealed = delivery.status === 'REVEALED';
    const message = await this.tg.sendMessage({
      chatId: delivery.chatId,
      text: revealed ? answerText(card) : questionText(card),
      keyboard: revealed ? gradeKeyboard(delivery.id) : revealKeyboard(delivery.id),
    });
    await db.telegramDelivery.update({ where: { id: delivery.id }, data: { messageId: message.message_id } });
  }

  // ---------- buttons ----------

  private async onCallback(query: TgCallbackQuery, now: Date): Promise<void> {
    const message = query.message;
    if (!message || !this.config.chatId || String(message.chat.id) !== this.config.chatId) return;
    const target: MessageRef = { chatId: this.config.chatId, messageId: message.message_id };

    const action = parseCallback(query.data ?? '');
    const delivery = action ? await db.telegramDelivery.findUnique({ where: { id: action.deliveryId } }) : null;
    const card = delivery ? await getCard(delivery.questionId) : null;
    if (!action || !delivery || !card || delivery.chatId !== target.chatId) {
      await this.tg.answerCallback(query.id, 'Картку не знайдено');
      return;
    }
    if (delivery.status === 'GRADED' || delivery.status === 'STALE') {
      await this.tg.answerCallback(query.id, 'Вже оцінено');
      return;
    }
    if (action.kind === 'reveal') await this.reveal(query.id, target, delivery, card, now);
    else await this.grade(query.id, target, delivery, card, action.grade, now);
  }

  private async reveal(queryId: string, target: MessageRef, delivery: TelegramDelivery, card: CardView, now: Date): Promise<void> {
    await db.telegramDelivery.updateMany({
      where: { id: delivery.id, status: 'SENT' },
      data: { status: 'REVEALED', revealedAt: now },
    });
    await this.tg.editMessage({ ...target, text: answerText(card), keyboard: gradeKeyboard(delivery.id) });
    await this.tg.answerCallback(queryId);
  }

  private async grade(
    queryId: string,
    target: MessageRef,
    delivery: TelegramDelivery,
    card: CardView,
    grade: BotGrade,
    now: Date,
  ): Promise<void> {
    if (await this.isStale(delivery)) {
      await this.markStale(delivery.id);
      await this.tg.editMessage({ ...target, text: answerText(card, STALE_FOOTER) }).catch(logEditError);
      await this.tg.answerCallback(queryId, 'Вже повторена в апці');
      await this.continueDay(target.chatId, now);
      return;
    }

    // Claim via a conditional UPDATE: of two identical presses (or a redelivered update) only one goes through.
    const claimed = await db.telegramDelivery.updateMany({
      where: { id: delivery.id, status: { in: OPEN_STATUSES } },
      data: { status: 'GRADED', grade, gradedAt: now },
    });
    if (claimed.count === 0) {
      await this.tg.answerCallback(queryId, 'Вже оцінено');
      return;
    }
    try {
      // time on the card: from sending to grading; reviewCard caps it at 3 min itself
      const seconds = (now.getTime() - delivery.sentAt.getTime()) / 1000;
      await reviewCard({ questionId: delivery.questionId, grade, seconds }, now);
    } catch (error) {
      await db.telegramDelivery.update({
        where: { id: delivery.id },
        data: { status: delivery.status, grade: null, gradedAt: null },
      });
      await this.tg.answerCallback(queryId, 'Не вийшло записати оцінку, спробуй ще раз');
      throw error;
    }

    const scheduled = (await getCard(delivery.questionId)) ?? card;
    // the grade is already saved: even if the message edit fails, the next card must still arrive
    await this.tg.editMessage({ ...target, text: answerText(scheduled, gradedFooter(grade, scheduled)) }).catch(logEditError);
    await this.tg.answerCallback(queryId, GRADE_LABELS[grade]);
    await this.continueDay(target.chatId, now);
  }

  // ---------- queue ----------

  private async continueDay(chatId: string, now: Date): Promise<void> {
    const result = await this.sendNext(chatId, now);
    if (result !== 'empty') return;
    const graded = await db.telegramDelivery.count({ where: { day: dayKey(now), chatId, status: 'GRADED' } });
    await this.tg.sendMessage({ chatId, text: doneText(graded) });
  }

  /** Next card from the app queue that was not sent today yet. */
  private async sendNext(chatId: string, now: Date): Promise<SendResult> {
    const day = dayKey(now);
    const card = await this.pickNext(day, now);
    if (!card) return 'empty';
    const deliveryId = await this.claim(card.id, day, chatId);
    if (deliveryId === null) return 'taken';
    await this.deliver(deliveryId, chatId, card);
    return 'sent';
  }

  private async pickNext(day: Date, now: Date): Promise<CardView | null> {
    const [queue, deliveredToday] = await Promise.all([
      getCardQueue(now),
      db.telegramDelivery.findMany({ where: { day }, select: { questionId: true } }),
    ]);
    const delivered = new Set(deliveredToday.map((delivery) => delivery.questionId));
    return queue.review.find((candidate) => !delivered.has(candidate.id)) ?? null;
  }

  /**
   * Delivery record before sending. Two guards:
   *   - UNIQUE (questionId, day): the same card cannot be inserted twice in a day;
   *   - advisory lock on the chat + open-card check: even two running bots cannot open two cards at once.
   */
  private async claim(questionId: number, day: Date, chatId: string): Promise<number | null> {
    try {
      return await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CLAIM_LOCK_NAMESPACE}::int, hashtext(${chatId}))`;
        const open = await tx.telegramDelivery.count({ where: { chatId, day, status: { in: OPEN_STATUSES } } });
        if (open > 0) return null;
        const delivery = await tx.telegramDelivery.create({ data: { questionId, day, chatId }, select: { id: true } });
        return delivery.id;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
      throw error;
    }
  }

  private async deliver(deliveryId: number, chatId: string, card: CardView): Promise<void> {
    try {
      const message = await this.tg.sendMessage({ chatId, text: questionText(card), keyboard: revealKeyboard(deliveryId) });
      await db.telegramDelivery.update({ where: { id: deliveryId }, data: { messageId: message.message_id } });
    } catch (error) {
      if (error instanceof TelegramError) {
        // Telegram refused: the message definitely does not exist, drop the record so the card can be sent later
        await db.telegramDelivery.delete({ where: { id: deliveryId } });
      } else {
        // network failure: unknown whether it arrived. The card is not sent again today (better skipped than twice),
        // but it is not kept open either, so /today can hand out the next one
        await this.markStale(deliveryId);
      }
      throw error;
    }
  }

  /** The card was graded in the app after sending: a grade from here would shift the schedule a second time. */
  private async isStale(delivery: TelegramDelivery): Promise<boolean> {
    const question = await db.question.findUnique({ where: { id: delivery.questionId }, select: { cardReviewedAt: true } });
    return question?.cardReviewedAt != null && question.cardReviewedAt > delivery.sentAt;
  }

  private async markStale(deliveryId: number): Promise<void> {
    await db.telegramDelivery.updateMany({
      where: { id: deliveryId, status: { in: OPEN_STATUSES } },
      data: { status: 'STALE' },
    });
  }
}
