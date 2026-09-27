/**
 * Парсер формату learn/ у репо з матеріалом. Та сама логіка є в graphql-base
 * (scripts/learn-format.mjs, її запускає CI): якщо міняєш формат, міняй в обох місцях.
 *
 * Картка = блок рядків між порожніми рядками.
 *   Q: питання / A: відповідь                 -> CONCEPT
 *   T: задача / Ref: файл / Check: команда     -> TASK
 * Рядок без ключа продовжує попереднє поле (багаторядкові відповіді).
 * Рядки з # і з відступом 4+ пробіли ігноруються. Абзац без жодного ключа теж.
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
  notes: string;
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

/** learn/topic.md: front matter name/track + необов'язкові нотатки нижче. */
export function parseTopic(text: string): ParsedTopic {
  const match = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const frontMatter = match?.[1];
  const body = match?.[2] ?? '';
  if (frontMatter === undefined) {
    return {
      name: '',
      track: 'OTHER',
      notes: '',
      errors: ['topic.md must start with front matter (--- name: ... track: ... ---)'],
    };
  }

  const meta = new Map<string, string>();
  for (const line of frontMatter.split('\n')) {
    const pair = line.match(/^(\w+):\s*(.*)$/);
    if (pair?.[1]) meta.set(pair[1], (pair[2] ?? '').trim());
  }

  const errors: string[] = [];
  const name = meta.get('name') ?? '';
  const trackRaw = meta.get('track') || 'OTHER';
  if (!name) errors.push('topic.md: name is required');

  let track: Track = 'OTHER';
  if (TRACKS.includes(trackRaw as Track)) track = trackRaw as Track;
  else errors.push(`topic.md: track must be one of ${TRACKS.join(', ')}`);

  return { name, track, notes: body.trim(), errors };
}
