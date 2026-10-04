import Link from 'next/link';
import { addSource, removeSource, syncAllNow, syncSourceNow } from '../actions';
import { SyncButton } from '@/components/SyncButton';
import { db } from '@/lib/db';
import { repoUrl } from '@/lib/sync';
import { GeminiCheck } from '@/components/GeminiCheck';
import { geminiModels, isGeminiConfigured } from '@/lib/gemini';
import { modelLabel } from '@/lib/ai-labels';
import { recentJobs, type AiJob } from '@/lib/ai-status';
import { lootAiSearchState, type LootAiSearchState } from '@/lib/loot-refill';

const LOOT_SEARCH_LABEL: Record<LootAiSearchState, string> = {
  off: 'вимкнено (LOOT_AI_SEARCH у .env)',
  on: 'увімкнено',
  blocked: 'на сьогодні вимкнено: пошук уперся в ліміт',
};

function jobLine(job: AiJob): string {
  const seconds = Math.round(((job.endedAt ?? Date.now()) - job.startedAt) / 1000);
  if (job.state === 'running') return `іде ${seconds} с, ${job.model ? modelLabel(job.model) : 'Gemini'}`;
  if (job.state === 'failed') return `не вийшло за ${seconds} с: ${job.error ?? ''}`;
  const trail = job.attempts.map((attempt) => `${modelLabel(attempt.model)}: ${attempt.detail}`).join(' → ');
  return `${job.model ? modelLabel(job.model) : 'Gemini'} за ${seconds} с${trail ? ` (до цього ${trail})` : ''}`;
}

export default async function SourcesPage() {
  const jobs = recentJobs();
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
        <code>learn/&lt;module&gt;/topic.md</code> makes a topic per folder. The app pulls cards on Sync
        and when Today opens (at most every 10 min, and only if there are new commits). A card you edit or delete on Cards → All cards
        is left alone by Sync after that.
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

      <h2 className="block-title" id="gemini">Gemini</h2>
      {isGeminiConfigured() ? (
        <div style={{ fontSize: 14 }}>
          <p className="muted" style={{ marginBottom: 8 }}>
            Моделі по черзі: {geminiModels().map(modelLabel).join(' → ')}. На ліміт, перевантаження (503), обрив відповіді, зависання чи 404 апка одразу йде до наступної.
            Пошук для скрині: {LOOT_SEARCH_LABEL[lootAiSearchState()]}.
          </p>
          <GeminiCheck />
          {jobs.length > 0 && (
            <>
              <h3 className="block-title">Останні запити</h3>
              <table className="db" data-testid="ai-jobs">
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id}>
                      <td style={{ width: 130 }}>{job.label}</td>
                      <td className="faint mono" style={{ width: 60 }}>{new Date(job.startedAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td><span className={`tag ${job.state === 'done' ? 'green' : job.state === 'failed' ? 'red' : 'blue'}`}>{job.state === 'done' ? 'ок' : job.state === 'failed' ? 'впав' : 'іде'}</span></td>
                      <td className="muted">{jobLine(job)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="faint" style={{ fontSize: 12 }}>Список живе, поки працює апка: після перезапуску він порожній.</p>
            </>
          )}
        </div>
      ) : (
        <p className="faint" style={{ fontSize: 14 }}>GEMINI_API_KEY не задано в .env: план за правилами, без AI-оцінки і mock-інтерв&apos;ю.</p>
      )}

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
