import Link from 'next/link';
import { createQuestion, updateQuestionText } from '../actions';
import { InlineText } from '@/components/InlineText';
import { db } from '@/lib/db';
import { Tag } from '@/components/Tag';
import { relativeDay } from '@/lib/schedule';

export default async function QuestionsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter } = await searchParams;
  const onlyTasks = filter === 'tasks';
  const now = new Date();
  const [questions, topics, taskCount, totalCount] = await Promise.all([
    db.question.findMany({
      where: onlyTasks ? { kind: 'TASK' } : {},
      include: { topic: true, syncSource: { select: { repo: true } } },
      orderBy: { id: 'desc' },
    }),
    db.topic.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.question.count({ where: { kind: 'TASK' } }),
    db.question.count(),
  ]);

  return (
    <div className="page wide">
      <div className="page-icon">❓</div>
      <h1 className="page-title">Questions</h1>
      <p className="page-sub">Questions, not notes. Q = explain in words (studied on the Cards page), Task = write code or design by hand (Recall and the plan). Cards marked with a repo are edited in that repo.</p>

      <div className="db-toolbar">
        <Link className={`db-tab ${!onlyTasks ? 'active' : ''}`} href="/questions">All · {totalCount}</Link>
        <Link className={`db-tab ${onlyTasks ? 'active' : ''}`} href="/questions?filter=tasks">Tasks · {taskCount}</Link>
        <span style={{ flex: 1 }} />
        <Link className="btn sm" href="/cards" style={{ marginBottom: 4 }}>🃏 Study cards</Link>
      </div>

      <table className="db">
        <thead>
          <tr><th style={{ width: 60 }}>Type</th><th>Aa Question</th><th>Topic</th><th>Reference</th><th>Next card</th></tr>
        </thead>
        <tbody>
          {questions.map((question) => (
            <tr key={question.id}>
              <td>
                <Tag color={question.kind === 'TASK' ? 'orange' : 'blue'}>{question.kind === 'TASK' ? 'Task' : 'Q'}</Tag>
              </td>
              <td className="title-cell" style={{ minWidth: 280 }}>
                {question.syncSource ? (
                  <div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{question.question}</div>
                    <div className="faint" style={{ fontSize: 12 }}>⇣ {question.syncSource.repo}</div>
                  </div>
                ) : (
                  <InlineText value={question.question} action={updateQuestionText.bind(null, question.id, 'question')} multiline />
                )}
              </td>
              <td style={{ width: 240 }}>
                {question.topic ? <Link href={`/topics/${question.topic.id}`} className="muted" style={{ fontSize: 13 }}>{question.topic.name}</Link> : <span className="faint">—</span>}
              </td>
              <td className="muted" style={{ fontSize: 13, maxWidth: 380 }}>
                {question.kind === 'TASK' ? (
                  <span className="mono">{question.ref || '—'}</span>
                ) : (
                  <>{question.reference.slice(0, 140)}{question.reference.length > 140 ? '…' : ''}</>
                )}
              </td>
              <td style={{ width: 96 }} className="muted">
                {question.kind === 'TASK' ? (
                  <span className="faint" title="Tasks are done in Recall, not on Cards">—</span>
                ) : question.cardDueAt === null ? (
                  <span className="tag blue">new</span>
                ) : (
                  <span style={{ fontSize: 13 }}>{question.cardDueAt <= now ? 'due' : relativeDay(question.cardDueAt, now)}</span>
                )}
              </td>
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
