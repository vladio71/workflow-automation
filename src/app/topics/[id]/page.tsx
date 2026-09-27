import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  createQuestion,
  deleteQuestion,
  deleteTopic,
  setQuestionInAnki,
  setTopicConfidence,
  setTopicCycle,
  setTopicTrack,
  updateQuestionText,
  updateTopicText,
} from '../../actions';
import { CheckItem } from '@/components/CheckItem';
import { InlineText } from '@/components/InlineText';
import { NotesEditor } from '@/components/NotesEditor';
import { Select } from '@/components/Select';
import { Tag } from '@/components/Tag';
import { LogTime } from '@/components/LogTime';
import { formatMinutes } from '@/lib/activity';
import { db } from '@/lib/db';
import { CONFIDENCES, TRACKS, optionFor, type Option } from '@/lib/labels';
import { relativeDay } from '@/lib/schedule';
import { refUrl, repoUrl } from '@/lib/sync';
import type { Confidence, Track } from '@/generated/prisma/enums';

export default async function TopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const topic = await db.topic.findUnique({
    where: { id: Number(id) },
    include: {
      questions: { orderBy: [{ kind: 'desc' }, { id: 'asc' }] },
      syncSource: true,
      recalls: { orderBy: { createdAt: 'desc' }, take: 10, include: { question: true } },
    },
  });
  if (!topic) notFound();
  const [cycles, timeSpent] = await Promise.all([
    db.cycle.findMany({ orderBy: { number: 'asc' } }),
    db.activityLog.aggregate({ where: { topicId: topic.id }, _sum: { minutes: true } }),
  ]);
  const cycleOptions: Option<string>[] = [
    { value: '', label: 'No cycle', color: 'gray' },
    ...cycles.map((cycle) => ({ value: String(cycle.id), label: `C${cycle.number} · ${cycle.name}`, color: 'blue' as const })),
  ];
  const now = new Date();
  const synced = topic.syncSource;
  const repoFile = synced && topic.drill ? refUrl(synced, topic.drill) : null;

  return (
    <div className="page">
      <div style={{ marginBottom: 14 }}><Link href="/topics" className="faint" style={{ fontSize: 14 }}>← Topics</Link></div>
      <div className="page-title">
        {synced ? topic.name : <InlineText value={topic.name} action={updateTopicText.bind(null, topic.id, 'name')} multiline />}
      </div>

      <div className="props" style={{ marginTop: 16 }}>
        <div className="k">◉ Track</div>
        <div className="v">
          {synced ? (
            <Tag color={optionFor(TRACKS, topic.track).color}>{optionFor(TRACKS, topic.track).label}</Tag>
          ) : (
            <Select<Track> value={topic.track} options={TRACKS} action={setTopicTrack.bind(null, topic.id)} />
          )}
        </div>
        {synced && (
          <>
            <div className="k">⇣ Synced from</div>
            <div className="v muted" style={{ gap: 8 }}>
              <a href={repoUrl(synced)} target="_blank" rel="noreferrer">{synced.repo}</a>
              <Link href="/sources" className="faint" style={{ fontSize: 13 }}>{synced.lastError ? '⚠ sync error' : 'learn/ · manage'}</Link>
            </div>
          </>
        )}
        <div className="k">◉ Confidence</div>
        <div className="v"><Select<Confidence> value={topic.confidence} options={CONFIDENCES} action={setTopicConfidence.bind(null, topic.id)} /></div>
        <div className="k">🗓 Last recall</div>
        <div className="v muted">{relativeDay(topic.lastRecallAt, now) || 'never'}</div>
        <div className="k">🔁 Next recall</div>
        <div className="v muted">{topic.nextReviewAt ? relativeDay(topic.nextReviewAt, now) : 'after first recall'}</div>
        <div className="k">⏱ Time spent</div>
        <div className="v muted">{formatMinutes(timeSpent._sum.minutes ?? 0)}</div>
        <div className="k">◉ Cycle</div>
        <div className="v"><Select<string> value={topic.cycleId ? String(topic.cycleId) : ''} options={cycleOptions} action={setTopicCycle.bind(null, topic.id)} /></div>
        <div className="k">⌘ Drill / file</div>
        <div className="v" style={{ gap: 8 }}>
          <InlineText value={topic.drill} action={updateTopicText.bind(null, topic.id, 'drill')} className="mono" />
          {repoFile && <a href={repoFile} target="_blank" rel="noreferrer" className="faint">↗</a>}
        </div>
        <div className="k">🔗 Source</div>
        <div className="v" style={{ gap: 8 }}>
          <InlineText value={topic.source} action={updateTopicText.bind(null, topic.id, 'source')} />
          {topic.source.startsWith('http') && <a href={topic.source} target="_blank" rel="noreferrer" className="faint">↗</a>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Link href={`/recall/${topic.id}`} className="btn primary">▶ Start recall</Link>
        <form action={deleteTopic.bind(null, topic.id)}><button className="btn ghost">Delete</button></form>
      </div>

      <h3 className="block-title">Log time on this topic</h3>
      <LogTime topicId={topic.id} />

      <div className="divider" />
      <h2 className="block-title" style={{ marginTop: 0 }}>Notes</h2>
      <p className="faint" style={{ fontSize: 13, marginBottom: 8 }}>Knowledge base for this topic. It is also the reference Gemini uses when checking your recall.</p>
      <NotesEditor value={topic.notes} action={updateTopicText.bind(null, topic.id, 'notes')} />

      <h2 className="block-title">Questions <span className="faint" style={{ fontWeight: 400, fontSize: 15 }}>{topic.questions.length}</span></h2>
      <p className="faint" style={{ fontSize: 13, marginBottom: 8 }}>
        {synced
          ? 'Cards marked "repo" come from learn/questions.md: edit them in the repo, the app pulls changes on Sync.'
          : 'Close the source, write 3-5 questions, answer from memory, then fill the reference.'}
      </p>
      {topic.questions.map((question) => {
        const fromRepo = question.sourceId !== null && synced !== null;
        const isTask = question.kind === 'TASK';
        return (
        <div key={question.id} className="card" style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ display: 'flex', gap: 4, paddingTop: 2 }}>
              <Tag color={isTask ? 'orange' : 'blue'}>{isTask ? 'Task' : 'Q'}</Tag>
              {fromRepo && <Tag color="gray">repo</Tag>}
            </span>
            <span style={{ fontWeight: 600, flex: 1, whiteSpace: 'pre-wrap' }}>
              {fromRepo ? question.question : <InlineText value={question.question} action={updateQuestionText.bind(null, question.id, 'question')} multiline />}
            </span>
            <Link href={`/recall/${topic.id}?q=${question.id}`} className="btn sm">{isTask ? 'Do it' : 'Recall'}</Link>
            {!fromRepo && <form action={deleteQuestion.bind(null, question.id)}><button className="btn sm ghost" title="Delete">✕</button></form>}
          </div>
          {isTask ? (
            <div style={{ fontSize: 13, marginTop: 8, display: 'grid', gap: 4 }}>
              {question.ref && (
                <div>
                  <span className="faint">Reference solution </span>
                  {synced ? <a href={refUrl(synced, question.ref)} target="_blank" rel="noreferrer" className="mono">{question.ref} ↗</a> : <span className="mono">{question.ref}</span>}
                </div>
              )}
              {question.check && <div><span className="faint">Check </span><code className="mono">{question.check}</code></div>}
            </div>
          ) : (
            <>
              <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>Reference</div>
              {fromRepo ? (
                <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{question.reference}</div>
              ) : (
                <InlineText value={question.reference} action={updateQuestionText.bind(null, question.id, 'reference')} placeholder="Correct answer after checking the source" multiline />
              )}
            </>
          )}
          {question.myAnswer && (
            <>
              <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>My last answer from memory</div>
              <div className="muted" style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{question.myAnswer}</div>
            </>
          )}
          {!isTask && (
            <div style={{ marginTop: 6, fontSize: 13 }}>
              <CheckItem checked={question.inAnki} label="In Anki" strike={false} action={setQuestionInAnki.bind(null, question.id)} />
            </div>
          )}
        </div>
        );
      })}
      <form action={createQuestion.bind(null, topic.id)}>
        <input name="question" className="input" placeholder="+ New question (Enter)" autoComplete="off" />
      </form>

      {topic.recalls.length > 0 && (
        <>
          <h2 className="block-title">Recall history</h2>
          <table className="db">
            <tbody>
              {topic.recalls.map((recall) => {
                const confidence = optionFor(CONFIDENCES, recall.confidenceAfter);
                return (
                  <tr key={recall.id}>
                    <td className="muted" style={{ width: 110 }}>{relativeDay(recall.createdAt, now)}</td>
                    <td style={{ width: 90 }}><Tag color={confidence.color}>{confidence.label}</Tag></td>
                    <td className="muted" style={{ fontSize: 13 }}>{recall.question?.question ?? 'Free recall'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
