'use server';

import { db } from '@/lib/db';
import { dayKey } from '@/lib/queries';
import {
  createCard, createCategory, deleteCard, getCardCounts, reviewCard, setCardCategory, setCategoryDeadline, updateCard,
  type CardTextInput, type CategoryChoice, type NewCardInput, type ReviewInput,
} from '@/lib/cards';
import { isDateKey } from '@/lib/learn-format';
import { ImportError, finishImport, importCards, previewImport, type ImportPreview, type ImportResult, type ImportTarget } from '@/lib/import-cards';
import { refresh } from './shared';

// ─── Review session ──────────────────────────────────────────────────────────

/**
 * Grade a card. No refresh(): otherwise every card would re-render the whole page and the session would crawl.
 * The page refreshes once, when the session ends (finishCardSession).
 */
export async function gradeCard(input: ReviewInput): Promise<{ remaining: number }> {
  const now = new Date();
  await reviewCard(input, now);
  const counts = await getCardCounts(now);
  const remaining = counts.due + counts.fresh;
  if (remaining === 0 && input.grade !== 'PRACTICE') {
    const day = dayKey(now);
    await db.dailyLog.upsert({ where: { day }, create: { day, cardsDone: true }, update: { cardsDone: true } });
  }
  return { remaining };
}

export async function finishCardSession(): Promise<void> {
  refresh();
}

// ─── Editing cards and categories ────────────────────────────────────────────

/** All cards -> New card. Returns false when the question is empty and no card was created. */
export async function addCard(input: NewCardInput): Promise<boolean> {
  const id = await createCard(input);
  if (id !== null) refresh();
  return id !== null;
}

/** The category chooser on a card. false = category unchanged (a repo card, or the card is gone). */
export async function chooseCardCategory(id: number, topicId: number | null): Promise<boolean> {
  const changed = await setCardCategory(id, topicId);
  if (changed) refresh();
  return changed;
}

/** "+ Add new" in the category chooser: a new topic with this name. null = empty name. */
export async function addCategory(name: string): Promise<CategoryChoice | null> {
  const category = await createCategory(name);
  if (category) refresh();
  return category;
}

/** All cards -> Edit. A repo card stops updating from questions.md after this. */
export async function editCard(id: number, input: CardTextInput): Promise<void> {
  await updateCard(id, input);
  refresh();
}

/** Category page -> Deadline. "" = remove. A YYYY-MM-DD date, stored without time. */
export async function changeCategoryDeadline(topicId: number, value: string): Promise<boolean> {
  if (value && !isDateKey(value)) return false;
  await setCategoryDeadline(topicId, value ? new Date(`${value}T00:00:00Z`) : null);
  refresh();
  return true;
}

/** All cards -> Delete. Sync will not bring a repo card back. */
export async function removeCard(id: number): Promise<void> {
  await deleteCard(id);
  refresh();
}

// ─── Import (Q:/A: text -> cards) ────────────────────────────────────────────

const MAX_IMPORT_CHARS = 500_000;

/** Import -> preview: how many cards were recognised and where the format errors are. */
export async function previewCardImport(text: string): Promise<ImportPreview> {
  return previewImport(text.slice(0, MAX_IMPORT_CHARS));
}

export type CardImportOutcome = { ok: true; result: ImportResult } | { ok: false; error: string };

/** Import -> Import. Format and deadline errors come back as text, not as throws. */
export async function runCardImport(text: string, target: ImportTarget): Promise<CardImportOutcome> {
  try {
    const result = await importCards(text.slice(0, MAX_IMPORT_CHARS), target);
    await finishImport(result);
    refresh();
    return { ok: true, result };
  } catch (error) {
    if (error instanceof ImportError) return { ok: false, error: error.message };
    throw error;
  }
}
