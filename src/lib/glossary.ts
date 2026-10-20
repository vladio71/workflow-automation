import 'server-only';
import { db } from '@/lib/db';

/** A glossary term as the client sees it (tooltips and the glossary list). */
export interface GlossaryEntry {
  id: number;
  /** null = applies in every category */
  topicId: number | null;
  term: string;
  aliases: string[];
  definition: string;
}

export interface GlossaryInput {
  term: string;
  aliases?: string[];
  definition: string;
}

function toEntry(row: { id: number; topicId: number | null; term: string; aliases: string[]; definition: string }): GlossaryEntry {
  return { id: row.id, topicId: row.topicId, term: row.term, aliases: row.aliases, definition: row.definition };
}

/** Every term, for pages that render cards from many categories. */
export async function getAllGlossary(): Promise<GlossaryEntry[]> {
  const rows = await db.glossaryTerm.findMany({ orderBy: [{ topicId: 'asc' }, { termKey: 'asc' }] });
  return rows.map(toEntry);
}

/** Terms of one category plus the global ones. */
export async function getGlossary(topicId: number | null): Promise<GlossaryEntry[]> {
  const rows = await db.glossaryTerm.findMany({
    where: topicId === null ? { topicId: null } : { OR: [{ topicId }, { topicId: null }] },
    orderBy: { termKey: 'asc' },
  });
  return rows.map(toEntry);
}

/** Add or update terms of a category (same term, case-insensitive, updates instead of duplicating). */
export async function upsertGlossary(topicId: number | null, terms: GlossaryInput[]): Promise<{ added: number; updated: number }> {
  let added = 0;
  let updated = 0;
  await db.$transaction(async (tx) => {
    for (const input of terms) {
      const term = input.term.trim();
      const termKey = term.toLowerCase();
      const aliases = (input.aliases ?? []).map((alias) => alias.trim()).filter((alias) => alias.length > 0);
      const data = { term, termKey, aliases, definition: input.definition.trim() };
      const existing = await tx.glossaryTerm.findFirst({ where: { topicId, termKey }, select: { id: true } });
      if (existing) {
        await tx.glossaryTerm.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await tx.glossaryTerm.create({ data: { ...data, topicId } });
        added++;
      }
    }
  });
  return { added, updated };
}

export async function deleteGlossaryTerm(topicId: number | null, term: string): Promise<boolean> {
  const result = await db.glossaryTerm.deleteMany({ where: { topicId, termKey: term.trim().toLowerCase() } });
  return result.count > 0;
}
