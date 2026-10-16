import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { rejectUnlessAutomation } from '@/lib/automation';
import { ImportError, finishImport, importCards } from '@/lib/import-cards';

/**
 * Імпорт карток скриптом або з чату, без репо: той самий формат, що learn/questions.md (Q:/A:).
 * Тільки з токеном (x-automation-token).
 *
 * Тіло: { text, topicId? | newCategory?, deadline? }
 *   text         текст у форматі Q:/A:
 *   topicId      id існуючої категорії
 *   newCategory  або назва нової категорії
 *   deadline     YYYY-MM-DD, необов'язково: категорія стає пріоритетною до цієї дати
 * Відповідь: { topicId, added, updated }
 */

const BodySchema = z.object({
  text: z.string().min(1).max(500_000),
  topicId: z.number().int().positive().optional(),
  newCategory: z.string().trim().min(1).max(120).optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const rejected = rejectUnlessAutomation(request);
  if (rejected) return rejected;

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'очікую { text, topicId? | newCategory?, deadline? }', issues: parsed.error.issues }, { status: 400 });
  }
  const { text, topicId, newCategory, deadline } = parsed.data;
  if (topicId !== undefined && newCategory !== undefined) {
    return Response.json({ error: 'topicId або newCategory, не обидва' }, { status: 400 });
  }

  try {
    const result = await importCards(text, { topicId: topicId ?? null, newCategory, deadline });
    await finishImport(result);
    revalidatePath('/', 'layout');
    return Response.json(result);
  } catch (error) {
    if (error instanceof ImportError) return Response.json({ error: error.message }, { status: 422 });
    throw error;
  }
}
