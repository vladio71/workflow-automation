import 'server-only';
import { db } from '@/lib/db';
import { isDateKey, parseQuestions } from '@/lib/learn-format';
import { touchCategory } from '@/lib/cards';

/**
 * Швидке додавання карток без репо і Sync: вставив текст у форматі questions.md (Q:/A:), вибрав категорію,
 * готово. Той самий парсер, що в Sync, тому формат один. Картки стають звичайними картками апки
 * (без sourceId), Sync їх не чіпає.
 *
 * Дублікати: питання, яке вже є в цій категорії (без урахування регістру і зайвих пробілів), не створюється
 * вдруге, а отримує нову відповідь. Розклад такої картки лишається.
 */

export interface ImportPreview {
  /** CONCEPT-картки, які будуть додані або оновлені */
  cards: { question: string; answer: string }[];
  /** T:-картки у тексті: сюди вони не імпортуються, тільки через репо */
  skippedTasks: number;
  errors: string[];
}

export function previewImport(text: string): ImportPreview {
  const parsed = parseQuestions(text);
  const cards = parsed.cards.filter((card) => card.kind === 'CONCEPT').map((card) => ({ question: card.question, answer: card.answer }));
  return { cards, skippedTasks: parsed.cards.length - cards.length, errors: parsed.errors };
}

export interface ImportTarget {
  /** існуюча категорія; null = без категорії (якщо newCategory теж порожнє) */
  topicId: number | null;
  /** створити категорію з такою назвою */
  newCategory?: string;
  /** дедлайн категорії, YYYY-MM-DD; "" = не чіпати */
  deadline?: string;
}

export interface ImportResult {
  topicId: number | null;
  added: number;
  updated: number;
}

export class ImportError extends Error {}

function normalize(question: string): string {
  return question.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Імпорт перевірених карток. Текст з помилками парсера сюди не доходить: previewImport перед цим. */
export async function importCards(text: string, target: ImportTarget): Promise<ImportResult> {
  const preview = previewImport(text);
  if (preview.errors.length > 0) throw new ImportError(preview.errors.join('\n'));
  if (preview.cards.length === 0) throw new ImportError('no Q:/A: cards in the text');
  if (target.deadline && !isDateKey(target.deadline)) throw new ImportError('deadline must be YYYY-MM-DD');

  return db.$transaction(async (tx) => {
    let topicId = target.topicId;
    const newName = target.newCategory?.trim() ?? '';
    if (newName) {
      const topic = await tx.topic.create({ data: { name: newName, track: 'OTHER' } });
      topicId = topic.id;
    }
    if (target.deadline && topicId !== null) {
      await tx.topic.update({ where: { id: topicId }, data: { deadline: new Date(`${target.deadline}T00:00:00Z`) } });
    }

    const existing = await tx.question.findMany({
      where: { kind: 'CONCEPT', topicId },
      select: { id: true, question: true },
    });
    const byQuestion = new Map(existing.map((question) => [normalize(question.question), question.id]));

    let added = 0;
    let updated = 0;
    const seen = new Set<string>();
    for (const card of preview.cards) {
      const key = normalize(card.question);
      if (seen.has(key)) continue; // той самий текст двічі в одному імпорті
      seen.add(key);
      const id = byQuestion.get(key);
      if (id === undefined) {
        await tx.question.create({ data: { kind: 'CONCEPT', question: card.question, reference: card.answer, topicId } });
        added += 1;
      } else {
        await tx.question.update({ where: { id }, data: { reference: card.answer } });
        updated += 1;
      }
    }
    return { topicId, added, updated };
  });
}

export async function finishImport(result: ImportResult): Promise<void> {
  if (result.topicId !== null) await touchCategory(result.topicId);
}
