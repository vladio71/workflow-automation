import Link from 'next/link';
import { createQuestion, setQuestionInAnki, updateQuestionText } from '../actions';
import { CheckItem } from '@/components/CheckItem';
import { InlineText } from '@/components/InlineText';
import { db } from '@/lib/db';

export default async function QuestionsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter } = await searchParams;
  const notInAnki = filter === 'not-in-anki';
  const [questions, topics, pendingAnki] = await Promise.all([
    db.question.findMany({ where: notInAnki ? { inAnki: false } : {}, include: { topic: true }, orderBy: { id: 'desc' } }),
    db.topic.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.question.count({ where: { inAnki: false } }),
  ]);

  return (
    <div className="page wide">
      <div className="page-icon">❓</div>
      <h1 className="page-title">Questions</h1>
      <p className="page-sub">Questions, not notes. Interview-style question, answer written from memory, reference after checking.</p>

      <div className="db-toolbar">
        <Link className={`db-tab ${!notInAnki ? 'active' : ''}`} href="/questions">All</Link>
        <Link className={`db-tab ${notInAnki ? 'active' : ''}`} href="/questions?filter=not-in-anki">Not in Anki · {pendingAnki}</Link>
        <span style={{ flex: 1 }} />
        {pendingAnki > 0 && <a className="btn sm" href="/api/anki-export" style={{ marginBottom: 4 }}>⬇ Export {pendingAnki} to Anki</a>}
      </div>

      <table className="db">
        <thead>
          <tr><th>Aa Question</th><th>Topic</th><th>Reference</th><th>Anki</th></tr>
        </thead>
        <tbody>
          {questions.map((question) => (
            <tr key={question.id}>
              <td className="title-cell" style={{ minWidth: 280 }}>
                <InlineText value={question.question} action={updateQuestionText.bind(null, question.id, 'question')} multiline />
              </td>
              <td style={{ width: 240 }}>
                {question.topic ? <Link href={`/topics/${question.topic.id}`} className="muted" style={{ fontSize: 13 }}>{question.topic.name}</Link> : <span className="faint">—</span>}
              </td>
              <td className="muted" style={{ fontSize: 13, maxWidth: 380 }}>{question.reference.slice(0, 140)}{question.reference.length > 140 ? '…' : ''}</td>
              <td style={{ width: 70 }}><CheckItem checked={question.inAnki} label="" strike={false} action={setQuestionInAnki.bind(null, question.id)} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <form action={createQuestion.bind(null, null)} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input name="question" className="input" placeholder="+ New question" autoComplete="off" />
        <select name="topicId" className="input" style={{ maxWidth: 320 }} defaultValue="">
          <option value="">No topic</option>
          {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
        </select>
        <button className="btn">Add</button>
      </form>
    </div>
  );
}
