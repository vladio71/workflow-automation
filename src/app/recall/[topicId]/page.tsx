import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RecallSession } from '@/components/RecallSession';
import { db } from '@/lib/db';
import { isGeminiConfigured } from '@/lib/gemini';

interface RecallPageProps {
  params: Promise<{ topicId: string }>;
  searchParams: Promise<{ q?: string }>;
}

export default async function RecallPage({ params, searchParams }: RecallPageProps) {
  const { topicId } = await params;
  const { q } = await searchParams;
  const topic = await db.topic.findUnique({
    where: { id: Number(topicId) },
    include: { questions: { orderBy: { id: 'asc' } } },
  });
  if (!topic) notFound();

  return (
    <div className="page">
      <div style={{ marginBottom: 14 }}>
        <Link href={`/topics/${topic.id}`} className="faint" style={{ fontSize: 14 }}>← {topic.name}</Link>
      </div>
      <div className="page-icon">🧠</div>
      <h1 className="page-title">Recall</h1>
      <p className="page-sub">Blank page, no peeking. Write everything you remember, then check. The struggle is the point.</p>
      <RecallSession
        topic={{ id: topic.id, name: topic.name, notes: topic.notes, drill: topic.drill }}
        questions={topic.questions.map((question) => ({ id: question.id, question: question.question, reference: question.reference }))}
        initialQuestionId={q ? Number(q) : null}
        geminiEnabled={isGeminiConfigured()}
      />
    </div>
  );
}
