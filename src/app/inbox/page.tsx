import { deleteInbox, inboxToQuestion, inboxToTopic } from '../actions';
import { QuickCapture } from '@/components/QuickCapture';
import { db } from '@/lib/db';
import { TRACKS } from '@/lib/labels';

export default async function InboxPage() {
  const items = await db.inboxItem.findMany({ orderBy: { createdAt: 'desc' } });

  return (
    <div className="page">
      <div className="page-icon">📥</div>
      <h1 className="page-title">Inbox</h1>
      <p className="page-sub">Capture without sorting. On Sunday turn each item into a topic or a question, or delete it.</p>
      <QuickCapture />
      <div style={{ marginTop: 16 }}>
        {items.length === 0 && <p className="faint">Inbox zero.</p>}
        {items.map((item) => (
          <div key={item.id} className="row-hover" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 6px', borderBottom: '1px solid var(--border)', borderRadius: 4 }}>
            <div style={{ flex: 1 }}>
              <div>{item.text}</div>
              <div className="faint" style={{ fontSize: 12 }}>{item.createdAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</div>
            </div>
            <details style={{ position: 'relative' }}>
              <summary className="btn sm" style={{ listStyle: 'none' }}>→ Topic</summary>
              <div className="select-menu" style={{ right: 0, left: 'auto' }}>
                {TRACKS.map((track) => (
                  <form key={track.value} action={inboxToTopic.bind(null, item.id, track.value)}>
                    <button className="select-option"><span className={`tag ${track.color}`}>{track.label}</span></button>
                  </form>
                ))}
              </div>
            </details>
            <form action={inboxToQuestion.bind(null, item.id)}><button className="btn sm">→ Question</button></form>
            <form action={deleteInbox.bind(null, item.id)}><button className="btn sm ghost" title="Delete">✕</button></form>
          </div>
        ))}
      </div>
    </div>
  );
}
