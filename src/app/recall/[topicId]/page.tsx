import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RecallSession } from '@/components/RecallSession';
import { db } from '@/lib/db';
import { isGeminiConfigured } from '@/lib/gemini';
import { refUrl } from '@/lib/sync';

interface RecallPageProps {
  params: Promise<{ topicId: string }>;
  searchParams: Promise<{ q?: string }>;
}

export default async function RecallPage({ params, searchParams }: RecallPageProps) {
  const { topicId } = await params;
  const { q } = await searchParams;
  const topic = await db.topic.findUnique({
    where: { id: Number(topicId) },
    include: { questions: { orderBy: [{ kind: 'desc' }, { id: 'asc' }] }, syncSource: true },
  });
  if (!topic) notFound();

  return (
    <div className="page">
      <div style={{ marginBottom: 14 }}>
        <Link href={`/topics/${topic.id}`} className="faint" style={{ fontSize: 14 }}>← {topic.name}</Link>
      </div>
      <h1 className="page-title">Recall</h1>
      <p className="page-sub">Blank page, no peeking. Write everything you remember, then check. The struggle is the point.</p>
      <RecallSession
        topic={{ id: topic.id, name: topic.name, notes: topic.notes, drill: topic.drill }}
        questions={topic.questions.map((question) => ({
          id: question.id,
          kind: question.kind,
          question: question.question,
          reference: question.reference,
          refUrl: topic.syncSource && question.ref ? refUrl(topic.syncSource, question.ref) : null,
          refPath: question.ref,
          check: question.check,
        }))}
        initialQuestionId={q ? Number(q) : null}
        geminiEnabled={isGeminiConfigured()}
      />
    </div>
  );
}
