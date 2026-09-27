import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MockChat } from '@/components/MockChat';
import { db } from '@/lib/db';

export default async function MockSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await db.mockSession.findUnique({ where: { id: Number(id) }, include: { messages: { orderBy: { id: 'asc' } } } });
  if (!session) notFound();

  return (
    <div className="page">
      <div style={{ marginBottom: 14 }}><Link href="/mock" className="faint" style={{ fontSize: 14 }}>← Mock interview</Link></div>
      <h1 className="page-title" style={{ fontSize: 30 }}>{session.problem}</h1>
      <MockChat
        sessionId={session.id}
        startedAt={session.startedAt.toISOString()}
        initial={session.messages.map((message) => ({ role: message.role, content: message.content }))}
      />
    </div>
  );
}
