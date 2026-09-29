'use client';

import { useState, useTransition } from 'react';
import { refillLootNow } from '@/app/actions';
import type { RefillResult } from '@/lib/loot-refill';

function describe(result: RefillResult): string {
  const added = Object.entries(result.added).map(([kind, count]) => `${kind} +${count}`);
  return added.length > 0 ? `Added: ${added.join(', ')}.` : 'Nothing new: the pool is full or the sources gave nothing.';
}

/** Наповнити пул зараз. Пошук Gemini може йти до хвилини. */
export function RefillButton() {
  const [result, setResult] = useState<RefillResult | null>(null);
  const [pending, startRefill] = useTransition();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
      <button className="btn sm" disabled={pending} onClick={() => startRefill(async () => setResult(await refillLootNow()))}>
        {pending ? 'Searching… (up to a minute)' : '↻ Refill now'}
      </button>
      {result && (
        <div style={{ fontSize: 13 }}>
          <div className="muted">{describe(result)}</div>
          {result.errors.map((error) => (
            <div key={error} style={{ color: 'var(--tag-red-fg)' }}>{error}</div>
          ))}
        </div>
      )}
    </div>
  );
}
