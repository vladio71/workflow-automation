import 'server-only';
import type { Cycle } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { dayKey } from '@/lib/queries';
import { getCardQueue } from '@/lib/cards';
import { getLevelsWithProgress, levelsDir } from '@/lib/levels';
import { MAP, cellOrder, drillOrder, getCell, getDrill, type Cell, type Drill } from '@/lib/content';
import { getAllCellStatuses, getLatestAttempts, nextCell, nextDrill, nextSpokenSubject, type SpokenSubject } from '@/lib/progress';
import { getSection, type Section } from '@/lib/sections';

/**
 * Норма дня: фіксована, без планування. Код сам обирає, що далі; усі слоти закриті = день закритий.
 *   1. нове: наступна клітинка карти або наступний дрил, залежно від розділу циклу
 *   2. повтор: закрита клітинка по пам'яті (через 2+ дні) або дрил зі старою спробою
 *   3. вголос: пройдене розказати англійською
 *   4. live code: рівні, як і раніше (повтори в термін, далі нові)
 *   + картки, в яких настав термін
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** повтор клітинки чи дрилу не раніше, ніж через стільки днів */
const REDO_AFTER_DAYS = 2;

export type SlotKey = 'new' | 'redo' | 'spoken' | 'levels' | 'cards';

export interface Slot {
  key: SlotKey;
  title: string;
  /** що саме сьогодні: "A3 · ~1k організацій", "Моніторинг · дрил 2"; null = слот порожній */
  subject: string | null;
  href: string;
  hint: string;
  done: boolean;
  /** порожній слот (нема що повторювати, нема рівнів): не блокує закриття дня */
  empty: boolean;
  /** для слоту «вголос»: ключ теми ("cell:A3"), який піде у відповідь */
  subjectKey?: string;
}

export interface SectionProgress {
  done: number;
  total: number;
}

export interface DailyNorm {
  cycle: Cycle | null;
  section: Section | null;
  sectionProgress: SectionProgress | null;
  slots: Slot[];
  allDone: boolean;
}

function isToday(stamp: Date | null | undefined, today: Date): boolean {
  return stamp !== null && stamp !== undefined && dayKey(stamp).getTime() === today.getTime();
}

function cellTitle(cell: Cell): string {
  const product = MAP.products.find((entry) => entry.id === cell.product);
  return `${cell.id} · ${product?.name ?? ''} · ${cell.scale[0]}`;
}

function drillTitle(drill: Drill): string {
  const found = getDrill(drill.id);
  const index = found ? found.module.drills.findIndex((entry) => entry.id === drill.id) + 1 : 0;
  return found ? `${found.module.short} · дрил ${index}: ${drill.q}` : drill.id;
}

export async function getDailyNorm(now: Date): Promise<DailyNorm> {
  const today = dayKey(now);
  const cycle = await db.cycle.findFirst({ where: { status: 'ACTIVE' }, orderBy: { number: 'asc' } });
  const section = cycle ? getSection(cycle.section) : null;
  const onDrills = section !== null && section.cellGroups.length === 0 && section.moduleIds.length > 0;
  const groups = section && section.cellGroups.length > 0 ? section.cellGroups : null;
  const modules = section && section.moduleIds.length > 0 ? section.moduleIds : null;

  const [statuses, latestAttempts, cellRows, redos, allAttempts, spokenToday, spokenSubject, cardQueue] = await Promise.all([
    getAllCellStatuses(),
    getLatestAttempts(),
    db.cellProgress.findMany(),
    db.cellRedo.findMany({ orderBy: { createdAt: 'desc' } }),
    db.drillAttempt.findMany({ select: { drillId: true, createdAt: true } }),
    db.spokenAnswer.count({ where: { day: today } }),
    nextSpokenSubject(now),
    getCardQueue(now),
  ]);
  // дрил, у якого є спроба до сьогодні, сьогодні йде як повтор; без такої спроби він новий
  const hadEarlierAttempt = (drillId: string): boolean => allAttempts.some((attempt) => attempt.drillId === drillId && attempt.createdAt.getTime() < today.getTime());
  const todayAttempts = allAttempts.filter((attempt) => isToday(attempt.createdAt, today));
  const firstAttemptToday = todayAttempts.some((attempt) => !hadEarlierAttempt(attempt.drillId));
  const redoneToday = todayAttempts.some((attempt) => hadEarlierAttempt(attempt.drillId));
  const lastRedoAt = new Map<string, Date>();
  for (const redo of redos) if (!lastRedoAt.has(redo.cellId)) lastRedoAt.set(redo.cellId, redo.createdAt);

  const slots: Slot[] = [];

  // 1. нове
  if (onDrills) {
    const drill = await nextDrill(modules);
    slots.push({
      key: 'new',
      title: 'Новий дрил',
      subject: drill ? drillTitle(drill) : null,
      href: drill ? `/minimum/${getDrill(drill.id)?.module.id ?? ''}#${drill.id}` : '/minimum',
      hint: 'Своя відповідь, потім еталон і чекліст.',
      done: firstAttemptToday,
      empty: drill === null,
    });
  } else {
    const cell = await nextCell(groups);
    const touchedToday = cellRows.some((row) => isToday(row.derivedAt, today) || isToday(row.checkedAt, today) || isToday(row.summarizedAt, today));
    slots.push({
      key: 'new',
      title: 'Нова клітинка',
      subject: cell ? cellTitle(cell) : null,
      href: cell ? `/map/${cell.id}` : '/map',
      hint: 'Вивів сам → звірив → своїми словами. Один крок на день теж рахується.',
      done: touchedToday,
      empty: cell === null,
    });
  }

  // 2. повтор
  if (onDrills) {
    const candidates: { drill: Drill; at: Date }[] = [];
    for (const drill of drillOrder()) {
      const moduleId = drill.id.slice(0, drill.id.lastIndexOf('-'));
      if (modules !== null && !modules.includes(moduleId)) continue;
      const latest = latestAttempts.get(drill.id);
      if (!latest) continue;
      if (latest.createdAt.getTime() > now.getTime() - REDO_AFTER_DAYS * DAY_MS) continue;
      candidates.push({ drill, at: latest.createdAt });
    }
    candidates.sort((a, b) => a.at.getTime() - b.at.getTime());
    const pick = candidates[0] ?? null;
    slots.push({
      key: 'redo',
      title: 'Повтор дрилу',
      subject: pick ? drillTitle(pick.drill) : null,
      href: pick ? `/minimum/${getDrill(pick.drill.id)?.module.id ?? ''}#${pick.drill.id}` : '/minimum',
      hint: pick ? 'Нова спроба з нуля, не дивлячись у минулу.' : 'Поки нема що повторювати: дрил повертається через 2 дні після спроби.',
      done: redoneToday,
      empty: pick === null,
    });
  } else {
    const candidates: { cell: Cell; at: Date }[] = [];
    for (const cell of cellOrder()) {
      if (groups !== null && !groups.includes(cell.group)) continue;
      const row = cellRows.find((entry) => entry.cellId === cell.id);
      if (!row || row.summarizedAt === null) continue;
      const last = lastRedoAt.get(cell.id) ?? row.summarizedAt;
      if (last.getTime() > now.getTime() - REDO_AFTER_DAYS * DAY_MS) continue;
      candidates.push({ cell, at: last });
    }
    candidates.sort((a, b) => a.at.getTime() - b.at.getTime());
    const pick = candidates[0] ?? null;
    slots.push({
      key: 'redo',
      title: 'Повтор клітинки',
      subject: pick ? cellTitle(pick.cell) : null,
      href: pick ? `/map/${pick.cell.id}#redo` : '/map',
      hint: pick ? 'Намалюй систему по пам\'яті і поясни текстом, потім звір зі схемою.' : 'Поки нема що повторювати: клітинка повертається через 2 дні після закриття.',
      done: redos.some((redo) => isToday(redo.createdAt, today)),
      empty: pick === null,
    });
  }

  // 3. вголос
  slots.push(spokenSlot(spokenSubject, spokenToday > 0));

  // 4. live code
  slots.push(await levelsSlot(now));

  // картки
  const due = cardQueue.due.length + cardQueue.fresh.length;
  slots.push({
    key: 'cards',
    title: 'Картки',
    subject: due > 0 ? `${due} на сьогодні` : null,
    href: '/cards',
    hint: due > 0 ? 'Space = відповідь, 1/2/3 = оцінка.' : 'На сьогодні порожньо.',
    done: due === 0,
    empty: due === 0 && cardQueue.reviewedToday === 0,
  });

  const sectionProgress = section ? sectionProgressOf(section, statuses, latestAttempts) : null;
  return {
    cycle,
    section,
    sectionProgress,
    slots,
    allDone: slots.every((slot) => slot.done || slot.empty),
  };
}

function spokenSlot(subject: SpokenSubject | null, doneToday: boolean): Slot {
  return {
    key: 'spoken',
    title: 'Вголос англійською',
    subject: subject ? subject.title : null,
    href: subject ? subject.href : '/map',
    hint: subject
      ? 'Розкажи за ~1,5 хв, як інтерв\'юеру. Запиши на диктофон, послухай, запиши одним рядком, що не вийшло сказати.'
      : 'З\'явиться, коли буде хоч одна звірена клітинка або дрил зі спробою.',
    done: doneToday,
    empty: subject === null,
    subjectKey: subject?.key,
  };
}

async function levelsSlot(now: Date): Promise<Slot> {
  if (!levelsDir()) {
    return { key: 'levels', title: 'Live code', subject: null, href: '/levels', hint: 'LEVELS_DIR не налаштований.', done: false, empty: true };
  }
  const { levels } = await getLevelsWithProgress(now);
  const passedToday = levels.some((level) => level.progress.passedToday);
  const due = levels.filter((level) => level.progress.status === 'DUE' && !level.progress.passedToday);
  const fresh = levels.find((level) => level.progress.status === 'NEW');
  const pick = due[0] ?? fresh ?? null;
  return {
    key: 'levels',
    title: 'Live code',
    subject: pick ? `${due.length > 0 ? 'повтор' : 'новий'} · ${pick.title}` : null,
    href: pick ? `/levels/${pick.key}` : '/levels',
    hint: due.length > 1 ? `Ще ${due.length - 1} у термін.` : 'Зелені тести = рівень пройдено.',
    done: passedToday,
    empty: pick === null,
  };
}

function sectionProgressOf(
  section: Section,
  statuses: Map<string, { done: boolean }>,
  latestAttempts: Map<string, unknown>,
): SectionProgress {
  if (section.cellGroups.length > 0) {
    const cells = cellOrder().filter((cell) => section.cellGroups.includes(cell.group));
    return { done: cells.filter((cell) => statuses.get(cell.id)?.done).length, total: cells.length };
  }
  const drills = drillOrder().filter((drill) => section.moduleIds.includes(drill.id.slice(0, drill.id.lastIndexOf('-'))));
  return { done: drills.filter((drill) => latestAttempts.has(drill.id)).length, total: drills.length };
}

/** Чи закрита клітинка і коли її востаннє повторювали: для блоку «Повтор» на сторінці клітинки. */
export async function getCellRedos(cellId: string): Promise<{ closed: boolean; redos: { id: number; text: string; createdAt: Date }[] }> {
  if (!getCell(cellId)) return { closed: false, redos: [] };
  const [row, redos] = await Promise.all([
    db.cellProgress.findUnique({ where: { cellId } }),
    db.cellRedo.findMany({ where: { cellId }, orderBy: { createdAt: 'desc' } }),
  ]);
  return { closed: row?.summarizedAt !== null && row?.summarizedAt !== undefined, redos };
}

export async function saveCellRedo(cellId: string, text: string): Promise<void> {
  if (!getCell(cellId)) throw new Error(`unknown cell ${cellId}`);
  const trimmed = text.trim();
  if (!trimmed) return;
  await db.cellRedo.create({ data: { cellId, text: trimmed } });
}
