'use server';

import { db } from '@/lib/db';
import { endOfDay, startOfDay } from '@/lib/schedule';
import { logActivity } from '@/lib/activity';
import { findLevel, getLevelDetails, levelsDir } from '@/lib/levels';
import { runLevel } from '@/lib/level-runner';
import { refresh } from './shared';

// ─── Levels (live-code exercises) ────────────────────────────────────────────

const MAX_CODE_CHARS = 200_000;

export type LevelRunResponse =
  | { ok: true; passed: boolean; timedOut: boolean; output: string; durationMs: number; reference: string | null }
  | { ok: false; error: string };

export type LevelGiveUpResponse = { ok: true; reference: string } | { ok: false; error: string };

/** Run the level's code through the exercise tests. Green tests = level passed. */
export async function runLevelAttempt(key: string, code: string, elapsedMinutes: number): Promise<LevelRunResponse> {
  const level = await findLevel(key);
  if (!level) return { ok: false, error: 'Level not found. Check LEVELS_DIR in .env.' };
  if (code.length > MAX_CODE_CHARS) return { ok: false, error: 'The code is too long.' };
  if (!code.trim()) return { ok: false, error: 'Write some code first.' };

  const result = await runLevel(levelsDir(), level, code);
  await db.levelAttempt.create({
    data: { levelKey: level.key, code, passed: result.passed, output: result.output, durationMs: result.durationMs },
  });
  if (result.passed) await logLevelTime(level.key, level.title, elapsedMinutes, level.minutes * 3, false);
  refresh();
  const reference = result.passed ? (await getLevelDetails(level)).reference : null;
  return { ok: true, passed: result.passed, timedOut: result.timedOut, output: result.output, durationMs: result.durationMs, reference };
}

/** Give up: open the reference before passing. The level comes back in 2 days; today's frame does not grow. */
export async function giveUpLevel(key: string, code: string, elapsedMinutes: number): Promise<LevelGiveUpResponse> {
  const level = await findLevel(key);
  if (!level) return { ok: false, error: 'Level not found. Check LEVELS_DIR in .env.' };
  await db.levelAttempt.create({ data: { levelKey: level.key, code: code.slice(0, MAX_CODE_CHARS), passed: false, gaveUp: true } });
  await logLevelTime(level.key, level.title, elapsedMinutes, level.minutes * 3, true);
  refresh();
  return { ok: true, reference: (await getLevelDetails(level)).reference };
}

/** Time on a level goes into Stats once per day: on the first pass or on giving up. */
async function logLevelTime(levelKey: string, title: string, elapsedMinutes: number, maxMinutes: number, gaveUp: boolean): Promise<void> {
  const now = new Date();
  const earlier = await db.levelAttempt.count({
    where: { levelKey, createdAt: { gte: startOfDay(now), lte: endOfDay(now) }, OR: [{ passed: true }, { gaveUp: true }] },
  });
  // The attempt just written is already in this count.
  if (earlier > 1) return;
  await logActivity({
    minutes: Math.min(Math.max(elapsedMinutes, 1), maxMinutes),
    kind: 'DRILL',
    topicId: null,
    track: 'NODE',
    note: `${gaveUp ? 'Level (gave up)' : 'Level'}: ${title}`,
  });
}
