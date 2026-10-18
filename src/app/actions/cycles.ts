'use server';

import { db } from '@/lib/db';
import type { CycleStatus } from '@/generated/prisma/enums';
import { refresh } from './shared';

export type CycleTextField = 'name' | 'goal' | 'retro';

export async function updateCycleText(id: number, field: CycleTextField, value: string): Promise<void> {
  await db.cycle.update({ where: { id }, data: { [field]: value } });
  refresh();
}

export async function createCycle(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return;
  const last = await db.cycle.findFirst({ orderBy: { number: 'desc' } });
  const hasActive = await db.cycle.count({ where: { status: 'ACTIVE' } });
  await db.cycle.create({
    data: { name, number: (last?.number ?? 0) + 1, goal: String(formData.get('goal') ?? '').trim(), status: hasActive ? 'PLANNED' : 'ACTIVE' },
  });
  refresh();
}

export async function deleteCycle(id: number): Promise<void> {
  await db.cycle.delete({ where: { id } });
  refresh();
}

/** Only one cycle can be active: the previous active one becomes Done. */
export async function setCycleStatus(id: number, status: CycleStatus): Promise<void> {
  await db.$transaction(async (tx) => {
    if (status === 'ACTIVE') {
      await tx.cycle.updateMany({ where: { status: 'ACTIVE', id: { not: id } }, data: { status: 'DONE' } });
    }
    await tx.cycle.update({ where: { id }, data: { status } });
  });
  refresh();
}
