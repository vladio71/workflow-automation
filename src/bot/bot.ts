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
 * Бот карток: другий клієнт до того самого розкладу, що й сторінка Cards.
 *   - о TELEGRAM_SEND_AT шле першу картку з черги на сьогодні (getCardQueue), наступну після оцінки;
 *   - "Показати відповідь", потім Забув / Важко / Згадав -> reviewCard, як в апці;
 *   - TelegramDelivery з UNIQUE (questionId, day): одна картка не приходить двічі за день навіть після рестарту
 *     чи з двома запущеними ботами; повторне натискання чи повторний апдейт оцінку вдруге не запише;
 *   - відкрита (без оцінки) картка на чат одна: наступна приходить тільки після оцінки.
 */

const OPEN_STATUSES: TelegramDeliveryStatus[] = ['SENT', 'REVEALED'];
/** порожню чергу перевіряємо не частіше: раптом Sync додасть картки */
const EMPTY_QUEUE_RECHECK_MS = 15 * 60 * 1000;
const RETRY_AFTER_ERROR_MS = 60 * 1000;
/** довільне число: простір імен для pg_advisory_xact_lock, щоб не перетнутись з іншими локами */
const CLAIM_LOCK_NAMESPACE = 7201;

/** sent: надіслали; empty: на сьогодні нічого; taken: відкрита картка вже є (або її щойно взяв інший процес бота) */
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
  /** dayKey().getTime() дня, для якого розсилку вже почато: щоб не питати БД кожен цикл */
  private startedDay: number | null = null;
  private nextCheckAt = 0;

  constructor(tg: TelegramClient, config: BotConfig) {
    this.tg = tg;
    this.config = config;
  }

  /** Кожен цикл polling: після TELEGRAM_SEND_AT почати день першою карткою, якщо сьогодні ще нічого не слали. */
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
    // якщо Telegram чи БД зараз падають, наступна спроба через хвилину, а не кожен цикл
    this.nextCheckAt = now.getTime() + RETRY_AFTER_ERROR_MS;
    const result = await this.sendNext(chatId, now);
    if (result === 'empty') this.nextCheckAt = now.getTime() + EMPTY_QUEUE_RECHECK_MS;
    else this.startedDay = day.getTime();
  }

  async handleUpdate(update: TgUpdate, now: Date): Promise<void> {
    if (update.callback_query) await this.onCallback(update.callback_query, now);
    else if (update.message) await this.onMessage(update.message, now);
  }

  // ---------- команди ----------

  private async onMessage(message: TgMessage, now: Date): Promise<void> {
    const chatId = String(message.chat.id);
    const command = parseCommand(message.text);
    if (!this.config.chatId) {
      if (command === '/start') await this.tg.sendMessage({ chatId, text: setupText(chatId) });
      return;
    }
    if (chatId !== this.config.chatId) return; // чужі чати ігноруємо мовчки
    if (command === '/today') await this.today(chatId, now);
    else if (command === '/start' || command === '/help') await this.tg.sendMessage({ chatId, text: helpText(this.config.sendAt) });
  }

  /** Є відкрита картка за сьогодні -> надіслати її ще раз унизу чату; нема -> наступна з черги. */
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

  // ---------- кнопки ----------

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

    // Claim умовним UPDATE: з двох однакових натискань (чи повторно доставленого апдейту) пройде тільки одне.
    const claimed = await db.telegramDelivery.updateMany({
      where: { id: delivery.id, status: { in: OPEN_STATUSES } },
      data: { status: 'GRADED', grade, gradedAt: now },
    });
    if (claimed.count === 0) {
      await this.tg.answerCallback(queryId, 'Вже оцінено');
      return;
    }
    try {
      // час на картку: від відправки до оцінки; reviewCard сам обріже до 3 хв
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
    // оцінка вже записана: навіть якщо повідомлення не оновилось, наступна картка має прийти
    await this.tg.editMessage({ ...target, text: answerText(scheduled, gradedFooter(grade, scheduled)) }).catch(logEditError);
    await this.tg.answerCallback(queryId, GRADE_LABELS[grade]);
    await this.continueDay(target.chatId, now);
  }

  // ---------- черга ----------

  private async continueDay(chatId: string, now: Date): Promise<void> {
    const result = await this.sendNext(chatId, now);
    if (result !== 'empty') return;
    const graded = await db.telegramDelivery.count({ where: { day: dayKey(now), chatId, status: 'GRADED' } });
    await this.tg.sendMessage({ chatId, text: doneText(graded) });
  }

  /** Наступна картка з черги апки, якої сьогодні ще не слали. */
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
   * Запис про доставку до відправки. Два захисти:
   *   - UNIQUE (questionId, day): та сама картка за день удруге не вставиться;
   *   - advisory lock на чат + перевірка відкритої картки: навіть два запущені боти не відкриють дві картки одночасно.
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
        // Telegram відмовив: повідомлення точно нема, знімаємо запис, щоб картку можна було надіслати пізніше
        await db.telegramDelivery.delete({ where: { id: deliveryId } });
      } else {
        // обрив мережі: невідомо, чи дійшло. Сьогодні картку більше не шлемо (краще пропустити, ніж двічі),
        // але й не тримаємо її відкритою, щоб /today міг дати наступну
        await this.markStale(deliveryId);
      }
      throw error;
    }
  }

  /** Картку після відправки вже оцінили в апці: оцінка звідси зсунула б розклад удруге. */
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
