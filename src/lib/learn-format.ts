/**
 * Парсер формату learn/ у репо з матеріалом. Та сама логіка є в graphql-base
 * (scripts/learn-format.mjs, її запускає CI): якщо міняєш формат, міняй в обох місцях.
 *
 * Картка = блок рядків між порожніми рядками.
 *   Q: питання / A: відповідь                 -> CONCEPT
 *   T: задача / Ref: файл / Check: команда     -> TASK
 * Рядок без ключа продовжує попереднє поле (багаторядкові відповіді).
 * Рядки з # і з відступом 4+ пробіли ігноруються. Абзац без жодного ключа теж.
 * Ref: шлях до файлу в репо або повний URL (https://...).
 *
 * learn/plan.md (необов'язково): навчальний план, послідовність кроків, див. parsePlan нижче.
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
  /** текст під front matter (якщо є) */
  notes: string;
  /** front matter `notes:` шлях до файлу в репо, який стає нотатками теми (наприклад README модуля) */
  notesFile: string;
  /** front matter `drill:` шлях до папки чи файлу з дрілами */
  drill: string;
  /** front matter `deadline: YYYY-MM-DD`: до цієї дати картки теми в пріоритеті; null = без дедлайну */
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

/** `---\nkey: value\n---\nтекст`: null, якщо front matter немає. */
/** "2026-10-19": рівно дата, і вона справжня (не 2026-02-30). */
export function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

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
 * topic.md: front matter + необов'язкові нотатки нижче.
 *   ---
 *   name: Caching          обов'язково
 *   track: SYSTEM_DESIGN   GRAPHQL | SYSTEM_DESIGN | NODE | AI | PYTHON | OTHER
 *   notes: modules/02-caching/README.md   необов'язково: файл, який стане нотатками теми
 *   drill: modules/02-caching             необов'язково: де лежать дріли
 *   deadline: 2026-10-19                  необов'язково: до цієї дати картки теми повторюються частіше
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
  /** стабільний id кроку: прогрес прив'язаний до нього, тому текст і порядок можна міняти */
  key: string;
  title: string;
  minutes: number;
  kind: PlanStepKind;
  /** URL або шлях у репо */
  link: string;
  /** папка теми в learn/ (для ATTEMPT обов'язково: спроба = recall цієї теми) */
  topic: string;
  /** останній заголовок `## ...` над кроком, наприклад "Тиждень 1" */
  group: string;
  line: number;
}

export interface ParsedPlan {
  name: string;
  /** скільки хвилин на день план бере собі в плані дня */
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
 * learn/plan.md: front matter (name, dailyMinutes) + кроки через порожній рядок.
 *   ## Тиждень 1              заголовок групи (для відображення)
 *
 *   S: URL shortener: спроба 45 хв
 *   Id: p01-attempt           латиниця, цифри, дефіс; унікальний
 *   Min: 45
 *   Kind: ATTEMPT             READ | ATTEMPT | REFERENCE | SUMMARY | DEPTH | EXAM (за замовчуванням READ)
 *   Topic: p01-url-shortener  папка в learn/
 *   Link: https://...         або шлях у репо
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

  // номер рядка body у файлі: front matter займає рядки до другого ---
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

/** Посилання з Ref:/Link: це повний URL, а не шлях у репо. */
export function isUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}
