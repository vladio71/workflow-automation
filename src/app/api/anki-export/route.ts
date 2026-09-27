import { db } from '@/lib/db';

/**
 * Файл для Anki (File -> Import): питання-концепти, яких ще немає в Anki.
 * TASK-картки (написати код руками) в Anki не йдуть: їх роблять у recall-сесії апки.
 * Після експорту позначаємо їх inAnki = true, щоб наступного разу не дублювати.
 */
export async function GET(): Promise<Response> {
  const questions = await db.question.findMany({ where: { inAnki: false, kind: 'CONCEPT' }, include: { topic: true }, orderBy: { id: 'asc' } });
  const clean = (text: string): string => text.replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
  const lines = [
    '#separator:tab',
    '#html:true',
    '#notetype:Basic',
    '#deck:Backend::Learning app',
    '#tags column:3',
    ...questions.map((question) => {
      const back = question.reference || question.myAnswer || '(fill the reference in the app)';
      const tag = question.topic ? question.topic.track.toLowerCase() : 'untagged';
      return `${clean(question.question)}\t${clean(back)}\t${tag}`;
    }),
  ];
  await db.question.updateMany({ where: { id: { in: questions.map((question) => question.id) } }, data: { inAnki: true } });

  const date = new Date().toISOString().slice(0, 10);
  return new Response(lines.join('\n'), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="anki-${date}.txt"`,
    },
  });
}
