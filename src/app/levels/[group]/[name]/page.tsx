import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LevelPlay } from '@/components/LevelPlay';
import { Markdown } from '@/components/Markdown';
import { Tag } from '@/components/Tag';
import { FRAME_ICON, type LevelFrame } from '@/lib/level-schedule';
import { getLevelDetails, getLevelsWithProgress, splitReadmeHints } from '@/lib/levels';
import { db } from '@/lib/db';
import { endOfDay, relativeDay, startOfDay } from '@/lib/schedule';

interface LevelPageProps {
  params: Promise<{ group: string; name: string }>;
}

const FRAME_LABEL: Record<LevelFrame, string> = { NONE: 'no frame yet', BRONZE: 'bronze', SILVER: 'silver', GOLD: 'gold' };

export default async function LevelPage({ params }: LevelPageProps) {
  const { group, name } = await params;
  const key = `${decodeURIComponent(group)}/${decodeURIComponent(name)}`;
  const now = new Date();
  const { levels } = await getLevelsWithProgress(now);
  const index = levels.findIndex((candidate) => candidate.key === key);
  const level = levels[index];
  if (!level) notFound();

  const [details, lastToday] = await Promise.all([
    getLevelDetails(level),
    db.levelAttempt.findFirst({
      where: { levelKey: key, createdAt: { gte: startOfDay(now), lte: endOfDay(now) } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  // умова без заголовка і рядка "~30 хв · ..." (вони вже в шапці сторінки), підказки окремо і згорнуті
  const readmeBody = details.readme
    .split('\n')
    .filter((line) => !line.startsWith('# ') && !line.trim().startsWith('**~'))
    .join('\n');
  const { body, hints } = splitReadmeHints(readmeBody);
  const { progress } = level;
  const revealed = progress.passedToday || progress.gaveUpToday;
  const next = levels[index + 1];

  return (
    <div className="page wide">
      <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between' }}>
        <Link href="/levels" className="faint" style={{ fontSize: 14 }}>← Levels · {level.groupTitle}</Link>
        {next && <Link href={`/levels/${next.key}`} className="faint" style={{ fontSize: 14 }}>{next.title} →</Link>}
      </div>
      <div className="page-icon">{FRAME_ICON[progress.frame] || '⚔️'}</div>
      <h1 className="page-title">{level.title}</h1>
      <p className="page-sub">
        ~{level.minutes} min · {level.difficulty}
        {level.pattern && <> · {level.pattern}</>}
        {' · '}{FRAME_LABEL[progress.frame]}
        {progress.dueAt && !progress.passedToday && (
          <> · {progress.status === 'DUE' ? <Tag color="red">redo now</Tag> : <>redo {relativeDay(progress.dueAt, now)}</>}</>
        )}
      </p>

      <div className="level-grid">
        <div>
          <Markdown>{body}</Markdown>
          {hints.map((hint) => (
            <details key={hint.summary} className="callout" style={{ display: 'block', marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 500 }}>{hint.summary}</summary>
              <div style={{ marginTop: 8 }}><Markdown>{hint.content}</Markdown></div>
            </details>
          ))}
        </div>
        <LevelPlay
          levelKey={level.key}
          title={level.title}
          fileName={level.stubFile}
          stub={details.stub}
          minutes={level.minutes}
          initialReference={revealed ? details.reference : null}
          passedToday={progress.passedToday}
          gaveUpToday={progress.gaveUpToday}
          lastOutput={lastToday ? { passed: lastToday.passed, output: lastToday.output } : null}
          nextHref={next ? `/levels/${next.key}` : null}
        />
      </div>
    </div>
  );
}
