import Link from 'next/link';
import { addSource, removeSource, syncAllNow, syncSourceNow } from '../actions';
import { SyncButton } from '@/components/SyncButton';
import { db } from '@/lib/db';
import { repoUrl } from '@/lib/sync';

export default async function SourcesPage() {
  const sources = await db.source.findMany({
    include: { topics: { select: { id: true, name: true }, orderBy: [{ sourcePath: 'asc' }] }, _count: { select: { questions: true } } },
    orderBy: { id: 'asc' },
  });

  return (
    <div className="page">
      <div className="page-icon">🔗</div>
      <h1 className="page-title">Sources</h1>
      <p className="page-sub">
        Repos with a <code>learn/</code> folder: <code>learn/topic.md</code> makes one topic for the repo,
        <code>learn/&lt;module&gt;/topic.md</code> makes a topic per folder. Cards are edited in the repo, the app pulls them on Sync
        and when Today opens (at most every 10 min, and only if there are new commits).
      </p>

      <div className="db-toolbar">
        <span className="muted" style={{ fontSize: 13 }}>{sources.length} repos</span>
        <span style={{ flex: 1 }} />
        {sources.length > 0 && <SyncButton label="↻ Sync all" action={syncAllNow} />}
      </div>

      {sources.length === 0 && <p className="faint" style={{ margin: '12px 0' }}>No repos yet.</p>}
      {sources.map((source) => (
        <div key={source.id} className="row-hover" style={{ padding: '10px 6px', borderBottom: '1px solid var(--border)', borderRadius: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <a href={repoUrl(source)} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>{source.repo}</a>
            <span className="tag gray">{source.branch}</span>
            {source.topics.length === 1 && source.topics[0] && (
              <Link href={`/topics/${source.topics[0].id}`} className="muted" style={{ fontSize: 13 }}>→ {source.topics[0].name}</Link>
            )}
            <span style={{ flex: 1 }} />
            <SyncButton label="↻ Sync" action={syncSourceNow.bind(null, source.id)} />
            <form action={removeSource.bind(null, source.id)}>
              <button className="btn sm ghost" title="Disconnect: the topic and cards stay, just stop syncing">Disconnect</button>
            </form>
          </div>
          {source.topics.length > 1 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 13, marginTop: 4 }}>
              {source.topics.map((topic) => (
                <Link key={topic.id} href={`/topics/${topic.id}`} className="muted">→ {topic.name}</Link>
              ))}
            </div>
          )}
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {source.lastError ? (
              <span style={{ color: '#eb5757' }}>⚠ {source.lastError}</span>
            ) : (
              <span className="muted">{source.lastSummary || 'not synced yet'}</span>
            )}
            {source.lastSyncedAt && (
              <span className="faint"> · {source.lastSyncedAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>
            )}
          </div>
        </div>
      ))}

      <form action={addSource} style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <input name="repo" className="input" placeholder="owner/repo or GitHub URL" autoComplete="off" required />
        <input name="branch" className="input" placeholder="main" style={{ maxWidth: 120 }} autoComplete="off" />
        <button className="btn">Add & sync</button>
      </form>

      <h2 className="block-title">Format</h2>
      <p className="muted" style={{ fontSize: 14 }}>
        <code>learn/topic.md</code> with front matter <code>name</code> and <code>track</code>, and <code>learn/questions.md</code> with cards
        separated by a blank line. Private repos need <code>GITHUB_TOKEN</code> in <code>.env</code>.
      </p>
      <pre className="mono" style={{ fontSize: 13, background: 'var(--callout)', padding: 12, borderRadius: 6, whiteSpace: 'pre-wrap' }}>
{`Q: What is null bubbling?
A: A failed non-null field turns its nearest nullable parent into null.

T: Write a DataLoader from scratch
Ref: drills/02-medium/06-dataloader-by-hand.ts
Check: npx tsx drills/02-medium/06-dataloader-by-hand.ts`}
      </pre>
    </div>
  );
}
