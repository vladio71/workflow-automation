import Link from 'next/link';
import { deleteActivity } from '../actions';
import { ActivityHeatmap, DailyBars } from '@/components/Charts';
import { LogTime } from '@/components/LogTime';
import { Tag } from '@/components/Tag';
import { db } from '@/lib/db';
import { formatMinutes, getAnalytics, getRecentLogs, type NamedMinutes } from '@/lib/activity';
import { ACTIVITY_KINDS, TRACKS, optionFor } from '@/lib/labels';
import type { ActivityKind, Track } from '@/generated/prisma/enums';

const HEATMAP_DAYS = 140;

function HBars({ items, labelFor }: { items: NamedMinutes[]; labelFor?: (item: NamedMinutes) => React.ReactNode }) {
  const max = Math.max(1, ...items.map((item) => item.minutes));
  if (items.length === 0) return <p className="faint" style={{ fontSize: 14 }}>No time logged yet.</p>;
  return (
    <div>
      {items.map((item) => (
        <div key={item.id} className="hbar" title={`${item.label}: ${formatMinutes(item.minutes)}`}>
          <span className="name">{labelFor ? labelFor(item) : item.label}</span>
          <div><div className="fill" style={{ width: `${(item.minutes / max) * 100}%` }} /></div>
          <span className="val">{formatMinutes(item.minutes)}</span>
        </div>
      ))}
    </div>
  );
}

export default async function StatsPage() {
  const [stats, recent, topics] = await Promise.all([
    getAnalytics(HEATMAP_DAYS),
    getRecentLogs(15),
    db.topic.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  const last30 = stats.daily.slice(-30);
  const best = last30.reduce((top, day) => (day.minutes > top.minutes ? day : top), { day: '', minutes: 0 });

  return (
    <div className="page wide">
      <h1 className="page-title">Stats</h1>
      <p className="page-sub">Where the time went. Recall and mock sessions are logged automatically, the rest you log below.</p>

      <div className="kpis">
        <div className="kpi">
          <div className="label">Current streak</div>
          <div className="value">{stats.streak.current}</div>
          <div className="hint">{stats.streak.activeToday ? 'today counted' : 'do something today to keep it'}</div>
        </div>
        <div className="kpi"><div className="label">Best streak</div><div className="value">{stats.streak.best}</div><div className="hint">days in a row</div></div>
        <div className="kpi"><div className="label">This week</div><div className="value">{formatMinutes(stats.weekMinutes)}</div><div className="hint">today {formatMinutes(stats.todayMinutes)}</div></div>
        <div className="kpi"><div className="label">Total</div><div className="value">{formatMinutes(stats.totalMinutes)}</div><div className="hint">{stats.activeDays} active days</div></div>
        <div className="kpi"><div className="label">Recalls</div><div className="value">{stats.recalls}</div><div className="hint">{stats.greenRecalls} green</div></div>
        <div className="kpi"><div className="label">Questions written</div><div className="value">{stats.questions}</div><div className="hint">{stats.mocks} {stats.mocks === 1 ? 'mock' : 'mocks'} done</div></div>
      </div>

      <h2 className="block-title">Log time</h2>
      <LogTime topics={topics} />

      <h2 className="block-title">Last 30 days</h2>
      <p className="faint" style={{ fontSize: 13, marginBottom: 6 }}>
        {best.minutes > 0 ? `Best day: ${formatMinutes(best.minutes)}. ` : ''}Hover a bar for the exact value.
      </p>
      <DailyBars data={last30} />

      <h2 className="block-title">Activity</h2>
      <ActivityHeatmap data={stats.daily} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 32 }}>
        <div>
          <h2 className="block-title">By track</h2>
          <HBars items={stats.byTrack} labelFor={(item) => {
            const track = optionFor(TRACKS, item.id as Track);
            return <Tag color={track.color}>{track.label}</Tag>;
          }} />
        </div>
        <div>
          <h2 className="block-title">By type</h2>
          <HBars items={stats.byKind} labelFor={(item) => {
            const kind = optionFor(ACTIVITY_KINDS, item.id as ActivityKind);
            return <Tag color={kind.color}>{kind.label}</Tag>;
          }} />
        </div>
      </div>

      <h2 className="block-title">By topic</h2>
      <HBars items={stats.byTopic.slice(0, 12)} labelFor={(item) =>
        item.id === 'none' ? <span className="faint">{item.label}</span> : <Link href={`/topics/${item.id}`}>{item.label}</Link>} />

      <h2 className="block-title">Recent</h2>
      <table className="db">
        <tbody>
          {recent.map((log) => {
            const kind = optionFor(ACTIVITY_KINDS, log.kind);
            return (
              <tr key={log.id}>
                <td className="muted" style={{ width: 110 }}>{log.day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</td>
                <td style={{ width: 70 }} className="mono">{formatMinutes(log.minutes)}</td>
                <td style={{ width: 110 }}><Tag color={kind.color}>{kind.label}</Tag></td>
                <td>{log.topic ? <Link href={`/topics/${log.topic.id}`}>{log.topic.name}</Link> : <span className="faint">—</span>}</td>
                <td className="muted" style={{ fontSize: 13 }}>{log.note}</td>
                <td style={{ width: 40 }}><form action={deleteActivity.bind(null, log.id)}><button className="btn sm ghost" title="Delete">✕</button></form></td>
              </tr>
            );
          })}
          {recent.length === 0 && <tr><td className="faint">Nothing yet. Log your first session above.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
