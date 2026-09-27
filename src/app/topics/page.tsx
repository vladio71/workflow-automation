import Link from 'next/link';
import { addTopicQuick, setTopicConfidence, setTopicCycle, setTopicTrack } from '../actions';
import { Select } from '@/components/Select';
import { db } from '@/lib/db';
import { CONFIDENCES, TRACKS, type Option } from '@/lib/labels';
import { relativeDay } from '@/lib/schedule';
import type { Confidence, Track } from '@/generated/prisma/enums';
import type { Prisma } from '@/generated/prisma/client';

type SortKey = 'due' | 'name' | 'confidence';

interface TopicsPageProps {
  searchParams: Promise<{ track?: string; confidence?: string; sort?: string }>;
}

const CONFIDENCE_ORDER: Record<Confidence, number> = { RED: 0, AMBER: 1, NOT_STARTED: 2, GREEN: 3 };

export default async function TopicsPage({ searchParams }: TopicsPageProps) {
  const params = await searchParams;
  const track = TRACKS.find((option) => option.value === params.track)?.value;
  const confidence = CONFIDENCES.find((option) => option.value === params.confidence)?.value;
  const sort: SortKey = params.sort === 'name' || params.sort === 'confidence' ? params.sort : 'due';

  const where: Prisma.TopicWhereInput = {};
  if (track) where.track = track;
  if (confidence) where.confidence = confidence;

  const [topics, cycles] = await Promise.all([
    db.topic.findMany({ where, include: { cycle: true, _count: { select: { questions: true } } }, orderBy: { id: 'asc' } }),
    db.cycle.findMany({ orderBy: { number: 'asc' } }),
  ]);

  topics.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'confidence') return CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence];
    const due = (value: Date | null) => value?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return due(a.nextReviewAt) - due(b.nextReviewAt);
  });

  const cycleOptions: Option<string>[] = [
    { value: '', label: 'No cycle', color: 'gray' },
    ...cycles.map((cycle) => ({ value: String(cycle.id), label: `C${cycle.number}`, color: 'blue' as const })),
  ];

  const query = (patch: Record<string, string | undefined>): string => {
    const next = new URLSearchParams();
    const merged = { track, confidence, sort, ...patch };
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
    const text = next.toString();
    return text ? `/topics?${text}` : '/topics';
  };
  const now = new Date();

  return (
    <div className="page wide">
      <div className="page-icon">🗂️</div>
      <h1 className="page-title">Topics</h1>
      <p className="page-sub">Retrospective timetable. Change Last recall only after recalling from memory, not after re-reading.</p>

      <div className="db-toolbar">
        <Link className={`db-tab ${!track ? 'active' : ''}`} href={query({ track: undefined })}>All</Link>
        {TRACKS.map((option) => (
          <Link key={option.value} className={`db-tab ${track === option.value ? 'active' : ''}`} href={query({ track: option.value })}>{option.label}</Link>
        ))}
        <span style={{ flex: 1 }} />
        <span className="faint" style={{ fontSize: 13 }}>Sort:</span>
        {(['due', 'confidence', 'name'] as const).map((key) => (
          <Link key={key} className={`db-tab ${sort === key ? 'active' : ''}`} href={query({ sort: key })}>{key}</Link>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '8px 0' }}>
        {CONFIDENCES.map((option) => (
          <Link key={option.value} href={query({ confidence: confidence === option.value ? undefined : option.value })} style={{ opacity: !confidence || confidence === option.value ? 1 : 0.4 }}>
            <span className={`tag ${option.color}`}>{option.label}</span>
          </Link>
        ))}
      </div>

      <table className="db">
        <thead>
          <tr>
            <th><span className="ico">Aa</span>Name</th>
            <th><span className="ico">◉</span>Track</th>
            <th><span className="ico">◉</span>Confidence</th>
            <th><span className="ico">🗓</span>Last recall</th>
            <th><span className="ico">🗓</span>Next review</th>
            <th><span className="ico">◉</span>Cycle</th>
            <th><span className="ico">#</span>Q</th>
          </tr>
        </thead>
        <tbody>
          {topics.map((topic) => {
            const overdue = topic.nextReviewAt !== null && topic.nextReviewAt.getTime() < now.getTime();
            return (
              <tr key={topic.id}>
                <td className="title-cell"><Link href={`/topics/${topic.id}`}>{topic.name}</Link></td>
                <td style={{ width: 140 }}><Select<Track> value={topic.track} options={TRACKS} action={setTopicTrack.bind(null, topic.id)} /></td>
                <td style={{ width: 130 }}><Select<Confidence> value={topic.confidence} options={CONFIDENCES} action={setTopicConfidence.bind(null, topic.id)} /></td>
                <td className="muted" style={{ width: 110 }}>{relativeDay(topic.lastRecallAt, now)}</td>
                <td style={{ width: 110, color: overdue ? '#eb5757' : undefined }} className={overdue ? '' : 'muted'}>{relativeDay(topic.nextReviewAt, now)}</td>
                <td style={{ width: 100 }}><Select<string> value={topic.cycleId ? String(topic.cycleId) : ''} options={cycleOptions} action={setTopicCycle.bind(null, topic.id)} /></td>
                <td className="faint" style={{ width: 50 }}>{topic._count.questions || ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <form action={addTopicQuick} style={{ display: 'flex', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
        <input name="name" className="bare" placeholder="+ New topic (Enter)" autoComplete="off" style={{ padding: '4px 8px' }} />
        <select name="track" className="input" style={{ width: 160, height: 28, padding: '0 8px' }} defaultValue={track ?? 'OTHER'}>
          {TRACKS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button className="btn sm">Add</button>
      </form>
      <p className="faint" style={{ fontSize: 13, marginTop: 8 }}>{topics.length} topics</p>
    </div>
  );
}
