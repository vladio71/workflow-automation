import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { db } from './db';
import { levelProgress, type LevelProgress } from './level-schedule';

/**
 * Levels = exercises from the local live-code clone (LEVELS_DIR in .env).
 * Exercise = folder exercises/<group>/<name> with README.md, index.ts(x) (stub), reference.ts(x) and index.test.ts(x).
 * Exercises are not copied into the DB: they are read from disk every time (dozens of small files), the DB holds only attempts.
 */
export interface Level {
  /** folder relative to exercises/: "04-async/07-dataloader". Key for attempts and for the URL */
  key: string;
  /** "04-async" */
  group: string;
  /** section heading from the repo README ("Async and Node") or the folder name */
  groupTitle: string;
  title: string;
  /** time from the README ("~30 min") */
  minutes: number;
  difficulty: string;
  pattern: string;
  /** order as in the repo (by folder names) */
  position: number;
  /** absolute path to the exercise folder */
  dir: string;
  /** the file the user writes: index.ts or index.tsx */
  stubFile: string;
  referenceFile: string;
}

export interface LevelsScan {
  dir: string;
  levels: Level[];
  /** why there are no levels (LEVELS_DIR unset, folder missing, etc.); null = all good */
  error: string | null;
}

export interface LevelWithProgress extends Level {
  progress: LevelProgress;
}

export interface LevelDetails {
  readme: string;
  stub: string;
  reference: string;
}

const DEFAULT_MINUTES = 25;

export function levelsDir(): string {
  return (process.env.LEVELS_DIR ?? '').trim();
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function firstExisting(dir: string, names: string[]): Promise<string | null> {
  for (const name of names) {
    try {
      await fs.access(path.join(dir, name));
      return name;
    } catch {
      // no such file, try the next one
    }
  }
  return null;
}

/** "### Async and Node" above a list of links to exercises/04-async/... -> 04-async = "Async and Node" */
function parseGroupTitles(rootReadme: string): Map<string, string> {
  const titles = new Map<string, string>();
  let heading = '';
  for (const line of rootReadme.split('\n')) {
    const headingMatch = /^###\s+(.+)$/.exec(line);
    if (headingMatch?.[1]) {
      heading = headingMatch[1].trim();
      continue;
    }
    const linkMatch = /\]\(exercises\/([^/)]+)\//.exec(line);
    if (linkMatch?.[1] && heading && !titles.has(linkMatch[1])) titles.set(linkMatch[1], heading);
  }
  return titles;
}

/** "# Title" and the "**~30 min · medium · pattern: ...**" line from the exercise README */
function parseReadmeMeta(readme: string): Pick<Level, 'title' | 'minutes' | 'difficulty' | 'pattern'> {
  const lines = readme.split('\n');
  const title = lines.find((line) => line.startsWith('# '))?.slice(2).trim() ?? '';
  const metaLine = lines.find((line) => line.trim().startsWith('**~')) ?? '';
  const parts = metaLine.replace(/\*\*/g, '').split('·').map((part) => part.trim());
  const minutesMatch = /~\s*(\d+)/.exec(parts[0] ?? '');
  return {
    title,
    minutes: minutesMatch?.[1] ? Number(minutesMatch[1]) : DEFAULT_MINUTES,
    difficulty: parts[1] ?? '',
    pattern: parts.slice(2).join(' · ').replace(/^патерн:\s*/, ''),
  };
}

export async function scanLevels(): Promise<LevelsScan> {
  const dir = levelsDir();
  if (!dir) return { dir, levels: [], error: 'LEVELS_DIR is not set in .env: put the path to your local live-code clone there.' };

  const exercisesDir = path.join(dir, 'exercises');
  let groups: string[];
  try {
    groups = (await fs.readdir(exercisesDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return { dir, levels: [], error: `No exercises/ folder in ${dir}. Check LEVELS_DIR.` };
  }

  const groupTitles = parseGroupTitles((await readIfExists(path.join(dir, 'README.md'))) ?? '');
  const levels: Level[] = [];
  for (const group of groups) {
    const names = (await fs.readdir(path.join(exercisesDir, group), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const name of names) {
      const levelDir = path.join(exercisesDir, group, name);
      const [readme, stubFile, referenceFile, testFile] = await Promise.all([
        readIfExists(path.join(levelDir, 'README.md')),
        firstExisting(levelDir, ['index.ts', 'index.tsx']),
        firstExisting(levelDir, ['reference.ts', 'reference.tsx']),
        firstExisting(levelDir, ['index.test.ts', 'index.test.tsx']),
      ]);
      // without tests or a reference the level checks nothing: skip it
      if (readme === null || !stubFile || !referenceFile || !testFile) continue;
      const meta = parseReadmeMeta(readme);
      levels.push({
        key: `${group}/${name}`,
        group,
        groupTitle: groupTitles.get(group) ?? group.replace(/^\d+-/, ''),
        ...meta,
        title: meta.title || name,
        position: levels.length,
        dir: levelDir,
        stubFile,
        referenceFile,
      });
    }
  }
  if (levels.length === 0) return { dir, levels, error: `No exercises with index.test.ts and reference.ts in ${exercisesDir}.` };
  return { dir, levels, error: null };
}

export async function getLevelDetails(level: Level): Promise<LevelDetails> {
  const [readme, stub, reference] = await Promise.all([
    readIfExists(path.join(level.dir, 'README.md')),
    readIfExists(path.join(level.dir, level.stubFile)),
    readIfExists(path.join(level.dir, level.referenceFile)),
  ]);
  return { readme: readme ?? '', stub: stub ?? '', reference: reference ?? '' };
}

/** All levels with progress (frame, repeat due date) from the attempts table. */
export async function getLevelsWithProgress(now: Date = new Date()): Promise<{ scan: LevelsScan; levels: LevelWithProgress[] }> {
  const scan = await scanLevels();
  if (scan.levels.length === 0) return { scan, levels: [] };
  const attempts = await db.levelAttempt.findMany({
    select: { levelKey: true, passed: true, gaveUp: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const byKey = new Map<string, { passed: boolean; gaveUp: boolean; createdAt: Date }[]>();
  for (const attempt of attempts) {
    const list = byKey.get(attempt.levelKey) ?? [];
    list.push(attempt);
    byKey.set(attempt.levelKey, list);
  }
  const levels = scan.levels.map((level) => ({ ...level, progress: levelProgress(byKey.get(level.key) ?? [], now) }));
  return { scan, levels };
}

export async function findLevel(key: string): Promise<Level | null> {
  const scan = await scanLevels();
  return scan.levels.find((level) => level.key === key) ?? null;
}

/** How many levels are due for a repeat. DB only, no disk reads: for the menu counter on every page. */
export async function getDueLevelCount(now: Date = new Date()): Promise<number> {
  if (!levelsDir()) return 0;
  const attempts = await db.levelAttempt.findMany({ select: { levelKey: true, passed: true, gaveUp: true, createdAt: true } });
  const byKey = new Map<string, { passed: boolean; gaveUp: boolean; createdAt: Date }[]>();
  for (const attempt of attempts) {
    const list = byKey.get(attempt.levelKey) ?? [];
    list.push(attempt);
    byKey.set(attempt.levelKey, list);
  }
  let count = 0;
  for (const list of byKey.values()) {
    const progress = levelProgress(list, now);
    if (progress.status === 'DUE' && !progress.passedToday) count += 1;
  }
  return count;
}

export interface ReadmeHint {
  summary: string;
  content: string;
}

/**
 * The exercise README keeps hints in <details> (raw HTML). The Markdown renderer drops HTML, so the hint text
 * would leak straight into the task statement. Hence <details> are extracted and rendered collapsed.
 */
export function splitReadmeHints(readme: string): { body: string; hints: ReadmeHint[] } {
  const hints: ReadmeHint[] = [];
  const body = readme.replace(/<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g, (_match, summary: string, content: string) => {
    hints.push({ summary: summary.trim(), content: content.trim() });
    return '';
  });
  return { body: body.trim(), hints };
}
