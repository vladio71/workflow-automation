import { db } from '@/lib/db';
import { streamMockReply, type ChatTurn } from '@/lib/gemini';

/**
 * POST { message } -> зберегти повідомлення кандидата, стрімити відповідь інтерв'юера текстом,
 * в кінці зберегти її цілком. Порожнє message = "почати інтерв'ю".
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const sessionId = Number(id);
  const body = (await request.json()) as { message?: string };
  const session = await db.mockSession.findUnique({ where: { id: sessionId }, include: { messages: { orderBy: { id: 'asc' } } } });
  if (!session) return new Response('Not found', { status: 404 });

  const text = (body.message ?? '').trim() || "Hi, I'm ready. Let's start.";
  await db.mockMessage.create({ data: { sessionId, role: 'USER', content: text } });
  if (text === 'END') await db.mockSession.update({ where: { id: sessionId }, data: { endedAt: new Date() } });

  const history: ChatTurn[] = [...session.messages.map((m) => ({ role: m.role, content: m.content })), { role: 'USER', content: text }];
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = '';
      let failed = false;
      try {
        for await (const chunk of streamMockReply(session.problem, history)) {
          full += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (error) {
        failed = true;
        const message = `\n\n[Gemini error: ${error instanceof Error ? error.message : 'unknown'}]`;
        controller.enqueue(encoder.encode(message));
      } finally {
        // помилку показуємо, але в історію не пишемо: інакше вона піде в Gemini як репліка інтерв'юера
        if (!failed && full.trim()) await db.mockMessage.create({ data: { sessionId, role: 'MODEL', content: full } });
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' } });
}
