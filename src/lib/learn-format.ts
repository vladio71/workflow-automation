/**
 * Parser for the learn/ format in a material repo. The same logic lives in graphql-base
 * (scripts/learn-format.mjs, run by CI): when changing the format, change both places.
 *
 * Card = a block of lines between blank lines.
 *   Q: question / A: answer                   -> CONCEPT
 *   T: task / Ref: file / Check: command       -> TASK
 * A line without a key continues the previous field (multi-line answers).
 * Lines starting with # or indented by 4+ spaces are ignored. So is a paragraph with no key at all.
 * Ref: path to a file in the repo or a full URL (https://...).
 *
 * learn/plan.md (optional): study plan, a sequence of steps, see parsePlan below.
 */
import type { Track } from '@/generated/prisma/client';

export type ParsedCardKind = 'CONCEPT' | 'TASK';

export interface ParsedCard {
  kind: ParsedCardKind;
  question: string;
  answer: string;
  ref: string;
  check: string;
  line: number;
}

export interface ParsedQuestions {
  cards: ParsedCard[];
  errors: string[];
}

export interface ParsedTopic {
  name: string;
  track: Track;
  /** text below the front matter (if any) */
  notes: string;
  /** front matter `notes:` path to a repo file that becomes the topic notes (e.g. a module README) */
  notesFile: string;
  /** front matter `drill:` path to a folder or file with drills */
  drill: string;
  /** front matter `deadline: YYYY-MM-DD`: until this date the topic's cards are prioritized; null = no deadline */
  deadline: string | null;
  errors: string[];
}

type FieldKey = 'Q' | 'A' | 'T' | 'Ref' | 'Check';

interface BlockLine {
  text: string;
  line: number;
}

const KEY = /^(Q|A|T|Ref|Check):\s?(.*)$/;
const TRACKS: Track[] = ['GRAPHQL', 'SYSTEM_DESIGN', 'NODE', 'AI', 'PYTHON', 'OTHER'];

export function parseQuestions(text: string): ParsedQuestions {
  const cards: ParsedCard[] = [];
  const errors: string[] = [];
  let block: BlockLine[] = [];

  const flush = (): void => {
    if (block.length === 0) return;
    if (!block.some((entry) => KEY.test(entry.text))) {
      block = [];
      return;
    }
    const fields: Partial<Record<FieldKey, string>> = {};
    let current: FieldKey | null = null;
    const startLine = block[0]?.line ?? 0;

    for (const entry of block) {
      const match = entry.text.match(KEY);
      if (match) {
        const key = match[1] as FieldKey;
        if (fields[key] !== undefined) errors.push(`line ${entry.line}: duplicate "${key}:" in one card`);
        fields[key] = (match[2] ?? '').trim();
        current = key;
      } else if (current) {
        fields[current] = `${fields[current]}\n${entry.text.trim()}`.trim();
      } else {
        errors.push(`line ${entry.line}: text outside a card field: "${entry.text.trim().slice(0, 40)}"`);
      }
    }
    block = [];

    if (fields.Q !== undefined) {
      if (fields.T !== undefined) errors.push(`line ${startLine}: card has both Q: and T:`);
      if (!fields.Q) errors.push(`line ${startLine}: empty Q:`);
      if (!fields.A) errors.push(`line ${startLine}: Q: without A: ("${fields.Q.slice(0, 40)}")`);
      if (fields.Ref !== undefined || fields.Check !== undefined) {
        errors.push(`line ${startLine}: Ref:/Check: belong to T: cards`);
      }
      cards.push({ kind: 'CONCEPT', question: fields.Q, answer: fields.A ?? '', ref: '', check: '', line: startLine });
    } else if (fields.T !== undefined) {
      if (!fields.T) errors.push(`line ${startLine}: empty T:`);
      if (fields.A !== undefined) errors.push(`line ${startLine}: T: cards use Ref:/Check:, not A:`);
      cards.push({
        kind: 'TASK',
        question: fields.T,
        answer: '',
        ref: fields.Ref ?? '',
        check: fields.Check ?? '',
        line: startLine,
      });
    } else {
      errors.push(`line ${startLine}: card must start with Q: or T:`);
    }
  };

  const lines = text.replace(/\r\n/g, '\n').split('\n');
  lines.forEach((raw, index) => {
    if (raw.trim() === '') {
      flush();
      return;
    }
    if (raw.startsWith('#') || raw.startsWith('    ')) return;
    block.push({ text: raw, line: index + 1 });
  });
  flush();

  const seen = new Map<string, number>();
  for (const card of cards) {
    const key = card.question.toLowerCase();
    const firstLine = seen.get(key);
    if (firstLine !== undefined) errors.push(`line ${card.line}: duplicate card (same as line ${firstLine})`);
    else seen.set(key, card.line);
  }
  return { cards, errors };
}

interface FrontMatter {
  meta: Map<string, string>;
  body: string;
}

/** "2026-10-19": exactly a date, and a real one (not 2026-02-30). */
export function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** `---\nkey: value\n---\ntext`: null when there is no front matter. */
function readFrontMatter(text: string): FrontMatter | null {
  const match = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const head = match?.[1];
  if (head === undefined) return null;
  const meta = new Map<string, string>();
  for (const line of head.split('\n')) {
    const pair = line.match(/^(\w+):\s*(.*)$/);
    if (pair?.[1]) meta.set(pair[1], (pair[2] ?? '').trim());
  }
  return { meta, body: match?.[2] ?? '' };
}

/**
 * topic.md: front matter + optional notes below.
 *   ---
 *   name: Caching          required
 *   track: SYSTEM_DESIGN   GRAPHQL | SYSTEM_DESIGN | NODE | AI | PYTHON | OTHER
 *   notes: modules/02-caching/README.md   optional: file that becomes the topic notes
 *   drill: modules/02-caching             optional: where the drills live
 *   deadline: 2026-10-19                  optional: until this date the topic's cards repeat more often
 *   ---
 */
export function parseTopic(text: string): ParsedTopic {
  const frontMatter = readFrontMatter(text);
  if (frontMatter === null) {
    return {
      name: '',
      track: 'OTHER',
      notes: '',
      notesFile: '',
      drill: '',
      deadline: null,
      errors: ['topic.md must start with front matter (--- name: ... track: ... ---)'],
    };
  }

  const { meta, body } = frontMatter;
  const errors: string[] = [];
  const name = meta.get('name') ?? '';
  const trackRaw = meta.get('track') || 'OTHER';
  if (!name) errors.push('topic.md: name is required');

  let track: Track = 'OTHER';
  if (TRACKS.includes(trackRaw as Track)) track = trackRaw as Track;
  else errors.push(`topic.md: track must be one of ${TRACKS.join(', ')}`);

  const deadlineRaw = meta.get('deadline') ?? '';
  let deadline: string | null = null;
  if (deadlineRaw) {
    if (isDateKey(deadlineRaw)) deadline = deadlineRaw;
    else errors.push(`topic.md: deadline must be YYYY-MM-DD, got "${deadlineRaw}"`);
  }

  return {
    name,
    track,
    notes: body.trim(),
    notesFile: meta.get('notes') ?? '',
    drill: meta.get('drill') ?? '',
    deadline,
    errors,
  };
}

// ------------------------------------------------------------------ learn/plan.md

export type PlanStepKind = 'READ' | 'ATTEMPT' | 'REFERENCE' | 'SUMMARY' | 'DEPTH' | 'EXAM';

export interface ParsedPlanStep {
  /** stable step id: progress is bound to it, so text and order can change */
  key: string;
  title: string;
  minutes: number;
  kind: PlanStepKind;
  /** URL or path in the repo */
  link: string;
  /** topic folder under learn/ (required for ATTEMPT: attempt = recall of this topic) */
  topic: string;
  /** last `## ...` heading above the step, e.g. "Week 1" */
  group: string;
  line: number;
}

export interface ParsedPlan {
  name: string;
  /** minutes per day the plan takes for itself in the day plan */
  dailyMinutes: number;
  steps: ParsedPlanStep[];
  errors: string[];
}

type PlanFieldKey = 'S' | 'Id' | 'Min' | 'Kind' | 'Link' | 'Topic';

const PLAN_KEY = /^(S|Id|Min|Kind|Link|Topic):\s?(.*)$/;
const PLAN_STEP_KINDS: PlanStepKind[] = ['READ', 'ATTEMPT', 'REFERENCE', 'SUMMARY', 'DEPTH', 'EXAM'];
const DEFAULT_DAILY_MINUTES = 180;
const MAX_STEP_MINUTES = 600;

/**
 * learn/plan.md: front matter (name, dailyMinutes) + steps separated by a blank line.
 *   ## Week 1                 group heading (for display)
 *
 *   S: URL shortener: attempt 45 min
 *   Id: p01-attempt           latin letters, digits, dashes; unique
 *   Min: 45
 *   Kind: ATTEMPT             READ | ATTEMPT | REFERENCE | SUMMARY | DEPTH | EXAM (default READ)
 *   Topic: p01-url-shortener  folder under learn/
 *   Link: https://...         or a path in the repo
 */
export function parsePlan(text: string): ParsedPlan {
  const frontMatter = readFrontMatter(text);
  if (frontMatter === null) {
    return { name: '', dailyMinutes: 0, steps: [], errors: ['plan.md must start with front matter (--- name: ... dailyMinutes: ... ---)'] };
  }

  const errors: string[] = [];
  const name = frontMatter.meta.get('name') ?? '';
  if (!name) errors.push('plan.md: name is required');
  const dailyRaw = frontMatter.meta.get('dailyMinutes');
  let dailyMinutes = DEFAULT_DAILY_MINUTES;
  if (dailyRaw !== undefined) {
    dailyMinutes = Number(dailyRaw);
    if (!Number.isInteger(dailyMinutes) || dailyMinutes <= 0) errors.push('plan.md: dailyMinutes must be a positive integer');
  }

  // line offset of the body in the file: the front matter takes the lines up to the second ---
  const headLines = text.replace(/\r\n/g, '\n').split('\n').length - frontMatter.body.split('\n').length;
  const steps: ParsedPlanStep[] = [];
  let group = '';
  let block: BlockLine[] = [];

  const flush = (): void => {
    if (block.length === 0) return;
    const lines = block;
    block = [];
    if (!lines.some((entry) => PLAN_KEY.test(entry.text))) return;

    const fields: Partial<Record<PlanFieldKey, string>> = {};
    let current: PlanFieldKey | null = null;
    const startLine = lines[0]?.line ?? 0;
    for (const entry of lines) {
      const match = entry.text.match(PLAN_KEY);
      if (match) {
        const key = match[1] as PlanFieldKey;
        if (fields[key] !== undefined) errors.push(`line ${entry.line}: duplicate "${key}:" in one step`);
        fields[key] = (match[2] ?? '').trim();
        current = key;
      } else if (current === 'S') {
        fields.S = `${fields.S ?? ''} ${entry.text.trim()}`.trim();
      } else {
        errors.push(`line ${entry.line}: text outside a step field: "${entry.text.trim().slice(0, 40)}"`);
      }
    }

    const title = fields.S ?? '';
    const key = fields.Id ?? '';
    const minutes = Number(fields.Min ?? '');
    const kindRaw = fields.Kind || 'READ';
    if (!title) errors.push(`line ${startLine}: step without S:`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) errors.push(`line ${startLine}: Id must be lowercase latin, digits and dashes`);
    if (!Number.isInteger(minutes) || minutes <= 0 || minutes > MAX_STEP_MINUTES) {
      errors.push(`line ${startLine}: Min must be an integer 1-${MAX_STEP_MINUTES}`);
    }
    let kind: PlanStepKind = 'READ';
    if (PLAN_STEP_KINDS.includes(kindRaw as PlanStepKind)) kind = kindRaw as PlanStepKind;
    else errors.push(`line ${startLine}: Kind must be one of ${PLAN_STEP_KINDS.join(', ')}`);
    const topic = fields.Topic ?? '';
    if (kind === 'ATTEMPT' && !topic) errors.push(`line ${startLine}: ATTEMPT step needs Topic:`);

    steps.push({ key, title, minutes, kind, link: fields.Link ?? '', topic, group, line: startLine });
  };

  frontMatter.body.split('\n').forEach((raw, index) => {
    const line = headLines + index + 1;
    if (raw.trim() === '') {
      flush();
      return;
    }
    const heading = raw.match(/^##\s+(.+)$/);
    if (heading?.[1]) {
      flush();
      group = heading[1].trim();
      return;
    }
    if (raw.startsWith('#') || raw.startsWith('    ')) return;
    block.push({ text: raw, line });
  });
  flush();

  const seen = new Map<string, number>();
  for (const step of steps) {
    const firstLine = seen.get(step.key);
    if (firstLine !== undefined) errors.push(`line ${step.line}: duplicate Id "${step.key}" (same as line ${firstLine})`);
    else seen.set(step.key, step.line);
  }
  if (steps.length === 0) errors.push('plan.md has no steps');

  return { name, dailyMinutes, steps, errors };
}

/** A Ref:/Link: value is a full URL, not a path in the repo. */
export function isUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}
