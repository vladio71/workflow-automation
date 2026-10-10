import Link from 'next/link';
import { Tag } from '@/components/Tag';
import type { TagColor } from '@/lib/labels';
import { FRAME_ICON, type LevelProgress } from '@/lib/level-schedule';
import { getLevelsWithProgress, type LevelWithProgress } from '@/lib/levels';
import { relativeDay } from '@/lib/schedule';

interface LevelGroup {
  title: string;
  levels: LevelWithProgress[];
}

function groupLevels(levels: LevelWithProgress[]): LevelGroup[] {
  const groups: LevelGroup[] = [];
  for (const level of levels) {
    const last = groups[groups.length - 1];
    if (last && last.title === level.groupTitle) last.levels.push(level);
    else groups.push({ title: level.groupTitle, levels: [level] });
  }
  return groups;
}

function statusTag(progress: LevelProgress, now: Date): { label: string; color: TagColor } {
  if (progress.passedToday) return { label: 'Done today', color: 'green' };
  if (progress.status === 'DUE') return { label: progress.stage === 0 ? 'Retry' : 'Redo now', color: 'red' };
  if (progress.status === 'WAITING') return { label: `Redo ${relativeDay(progress.dueAt, now)}`, color: 'blue' };
  return { label: 'New', color: 'gray' };
}

export default async function LevelsPage() {
  const now = new Date();
  const { scan, levels } = await getLevelsWithProgress(now);
  const passed = levels.filter((level) => level.progress.stage > 0).length;
  const due = levels.filter((level) => level.progress.status === 'DUE' && !level.progress.passedToday).length;
  const gold = levels.filter((level) => level.progress.frame === 'GOLD').length;

  return (
    <div className="page">
      <h1 className="page-title">Levels</h1>
      <p className="page-sub">
        Exercises from your live-code clone. Paste your code, the app runs the exercise tests: green = level cleared. Redo from scratch
        after 2 days, then 7 and 21: the frame goes 🥉 → 🥈 → 🥇. Opening the reference before you pass counts as giving up.
      </p>

      {scan.error ? (
        <div className="callout">
          <div>
            <div>{scan.error}</div>
            <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>
              In <code className="mono">.env</code>: <code className="mono">LEVELS_DIR=&quot;C:/path/to/live-code&quot;</code>, then{' '}
              <code className="mono">npm install</code> once inside live-code and restart the app.
            </div>
          </div>
        </div>
      ) : (
        <div className="kpis" style={{ marginBottom: 20 }}>
          <div className="kpi"><div className="label">Cleared</div><div className="value">{passed}/{levels.length}</div></div>
          <div className="kpi"><div className="label">Redo now</div><div className="value">{due}</div></div>
          <div className="kpi"><div className="label">Gold</div><div className="value">{gold}</div></div>
        </div>
      )}

      {groupLevels(levels).map((group) => (
        <div key={group.title}>
          <h2 className="block-title">{group.title}</h2>
          <table className="db">
            <tbody>
              {group.levels.map((level) => {
                const tag = statusTag(level.progress, now);
                return (
                  <tr key={level.key}>
                    <td style={{ width: 32, textAlign: 'center' }}>{FRAME_ICON[level.progress.frame] || '·'}</td>
                    <td className="title-cell"><Link href={`/levels/${level.key}`}>{level.title}</Link></td>
                    <td className="muted" style={{ width: 120 }}>{level.difficulty}</td>
                    <td className="muted mono" style={{ width: 60 }}>{level.minutes}m</td>
                    <td style={{ width: 120 }}><Tag color={tag.color}>{tag.label}</Tag></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
