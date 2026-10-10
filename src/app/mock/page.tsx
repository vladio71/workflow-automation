import Link from 'next/link';
import { startMock } from '../actions';
import { db } from '@/lib/db';
import { isGeminiConfigured } from '@/lib/gemini';

const PROBLEMS: readonly string[] = [
  'Design Twitter (home timeline)',
  'Design a URL shortener',
  'Design a chat app (WhatsApp)',
  'Design a rate limiter',
  'Design a notification service',
  'Design Stripe-like webhook processing (idempotent, retries)',
  'Design a news feed with ranking',
  'Design a file storage service (Dropbox)',
  'Design a ride-hailing dispatch (Uber)',
  'Design a job queue / scheduler',
];

export default async function MockPage() {
  const sessions = await db.mockSession.findMany({ orderBy: { startedAt: 'desc' }, include: { _count: { select: { messages: true } } } });
  const enabled = isGeminiConfigured();

  return (
    <div className="page">
      <h1 className="page-title">Mock interview</h1>
      <p className="page-sub">System design, 45 minutes, out loud or typed. Gemini plays the interviewer: one question at a time, pushes on trade-offs. Type END to get feedback.</p>
      {!enabled && <div className="callout"><div>Set <span className="mono">GEMINI_API_KEY</span> in <span className="mono">.env</span> to use mock interviews.</div></div>}

      <form action={startMock} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <b>New mock</b>
        <select name="problem" className="input">
          {PROBLEMS.map((problem) => <option key={problem}>{problem}</option>)}
        </select>
        <input name="custom" className="input" placeholder="…or your own problem" autoComplete="off" />
        <div><button className="btn primary" disabled={!enabled}>Start · 45 min</button></div>
      </form>

      <h2 className="block-title">Past sessions</h2>
      <table className="db">
        <tbody>
          {sessions.map((session) => (
            <tr key={session.id}>
              <td className="title-cell"><Link href={`/mock/${session.id}`}>{session.problem}</Link></td>
              <td className="muted" style={{ width: 160 }}>{session.startedAt.toLocaleDateString('en-GB')}</td>
              <td className="faint" style={{ width: 120 }}>{session._count.messages} messages</td>
            </tr>
          ))}
          {sessions.length === 0 && <tr><td className="faint">No mocks yet. One per week.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
