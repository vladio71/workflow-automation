import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { db } from './db';
import { levelProgress, type LevelProgress } from './level-schedule';

/**
 * Рівні = вправи з локального клону live-code (LEVELS_DIR у .env).
 * Вправа = папка exercises/<група>/<назва> з README.md, index.ts(x) (заготовка), reference.ts(x) і index.test.ts(x).
 * Самі вправи в БД не копіюємо: читаємо з диска щоразу (це десятки маленьких файлів), у БД тільки спроби.
 */
export interface Level {
  /** папка відносно exercises/: "04-async/07-dataloader". Ключ для спроб і для URL */
  key: string;
  /** "04-async" */
  group: string;
  /** заголовок розділу з README репо ("Async і Node") або назва папки */
  groupTitle: string;
  title: string;
  /** час з README ("~30 хв") */
  minutes: number;
  difficulty: string;
  pattern: string;
  /** порядок як у репо (за назвами папок) */
  position: number;
  /** абсолютний шлях до папки вправи */
  dir: string;
  /** файл, який пишеш ти: index.ts або index.tsx */
  stubFile: string;
  referenceFile: string;
}

export interface LevelsScan {
  dir: string;
  levels: Level[];
  /** чому рівнів немає (LEVELS_DIR не заданий, папки немає тощо); null = все добре */
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
      // немає такого файлу, пробуємо наступний
    }
  }
  return null;
}

/** "### Async і Node" над списком з посиланнями на exercises/04-async/... -> 04-async = "Async і Node" */
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

/** "# Title" і рядок "**~30 хв · medium · патерн: ...**" з README вправи */
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
      // без тестів або еталону рівень нічого не перевіряє: пропускаємо
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

/** Усі рівні з прогресом (рамка, термін повтору) з таблиці спроб. */
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

/** Скільки рівнів чекає на повтор. Тільки з БД, без читання диска: для лічильника в меню на кожній сторінці. */
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
 * README вправи має підказку в <details> (сирий HTML). Markdown-рендер HTML не показує, і текст підказки
 * вилазив би прямо в умову. Тому виймаємо <details> окремо і малюємо їх згорнутими.
 */
export function splitReadmeHints(readme: string): { body: string; hints: ReadmeHint[] } {
  const hints: ReadmeHint[] = [];
  const body = readme.replace(/<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g, (_match, summary: string, content: string) => {
    hints.push({ summary: summary.trim(), content: content.trim() });
    return '';
  });
  return { body: body.trim(), hints };
}
