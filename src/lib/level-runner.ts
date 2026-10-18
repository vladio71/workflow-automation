import 'server-only';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Level } from './levels';

/**
 * Runs the submitted code against the exercise tests. The index.ts in the repo is never touched:
 *   1. copy the exercise to <LEVELS_DIR>/.level-attempts/<level>/ (tests, reference, types, everything except the stub and README);
 *   2. index.ts(x) = the submitted code;
 *   3. vitest from live-code (its node_modules) with --root at this copy; REF is unset, so the tests use the submitted index;
 *   4. delete the copy. The .level-attempts folder has its own .gitignore with "*", so git status never shows it.
 *
 * The command is fixed (node + vitest from the repo's node_modules), no shell: no strings from the repo or the form reach the command line.
 * The code runs on the local machine, which is why the app listens only on 127.0.0.1 (package.json).
 */
export interface RunResult {
  passed: boolean;
  timedOut: boolean;
  output: string;
  durationMs: number;
}

/** a normal run takes 1-3 s; 30 s means it is definitely stuck */
const RUN_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 20_000;
const ATTEMPTS_DIR = '.level-attempts';

/** ESC [ ... letter: colours and cursor moves in vitest output */
const ANSI_PATTERN = new RegExp(String.fromCharCode(27) + '\\[[0-9;?]*[A-Za-z]', 'g');

function cleanOutput(raw: string): string {
  const text = raw.replace(ANSI_PATTERN, '').replace(/\r\n/g, '\n').trim();
  return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… (output cut)` : text;
}

/** One run at a time: two vitest processes on the same folder only get in each other's way. */
let queue: Promise<unknown> = Promise.resolve();

export function runLevel(levelsDir: string, level: Level, code: string): Promise<RunResult> {
  const run = queue.then(() => runOnce(levelsDir, level, code));
  queue = run.catch(() => undefined);
  return run;
}

async function runOnce(levelsDir: string, level: Level, code: string): Promise<RunResult> {
  const vitestEntry = path.join(levelsDir, 'node_modules', 'vitest', 'vitest.mjs');
  try {
    await fs.access(vitestEntry);
  } catch {
    return {
      passed: false,
      timedOut: false,
      output: `vitest not found in ${levelsDir}. Run "npm install" in the live-code folder once.`,
      durationMs: 0,
    };
  }

  const attemptsRoot = path.join(levelsDir, ATTEMPTS_DIR);
  const attemptDir = path.join(attemptsRoot, level.key.replace(/[\\/]/g, '__'));
  await fs.mkdir(attemptsRoot, { recursive: true });
  await fs.writeFile(path.join(attemptsRoot, '.gitignore'), '*\n');
  await fs.rm(attemptDir, { recursive: true, force: true });
  await fs.cp(level.dir, attemptDir, {
    recursive: true,
    filter: (source) => {
      const name = path.basename(source);
      return name !== 'README.md' && name !== level.stubFile && name !== 'node_modules';
    },
  });
  await fs.writeFile(path.join(attemptDir, level.stubFile), code);

  const env: NodeJS.ProcessEnv = { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' };
  delete env.REF; // REF=1 would switch the tests to the reference solution

  const started = Date.now();
  try {
    return await new Promise<RunResult>((resolve) => {
      const child = spawn(process.execPath, [vitestEntry, 'run', '--root', attemptDir, '--pool=threads'], {
        cwd: levelsDir,
        env,
        windowsHide: true,
      });
      let output = '';
      let timedOut = false;
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      // --pool=threads: tests run in threads of this process, so kill also stops an endless loop in the submitted code
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, RUN_TIMEOUT_MS);
      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({ passed: false, timedOut: false, output: `Could not start vitest: ${error.message}`, durationMs: Date.now() - started });
      });
      child.on('close', (exitCode) => {
        clearTimeout(timer);
        const text = cleanOutput(output);
        resolve({
          passed: exitCode === 0 && !timedOut,
          timedOut,
          output: timedOut ? `${text}\n\nStopped after ${RUN_TIMEOUT_MS / 1000} s: an endless loop or a promise that never settles?` : text,
          durationMs: Date.now() - started,
        });
      });
    });
  } finally {
    await fs.rm(attemptDir, { recursive: true, force: true });
  }
}
