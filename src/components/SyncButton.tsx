'use client';

import { useState, useTransition } from 'react';
import type { SyncResult } from '@/lib/sync';

interface SyncButtonProps {
  label: string;
  action: () => Promise<SyncResult | SyncResult[]>;
}

/** Sync button: shows the result right next to it, without a page reload. */
export function SyncButton({ label, action }: SyncButtonProps) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');

  const run = (): void => {
    setMessage('');
    startTransition(async () => {
      const result = await action();
      const results = Array.isArray(result) ? result : [result];
      const failed = results.filter((item) => !item.ok).length;
      setMessage(failed > 0 ? `${failed} failed` : 'done');
    });
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button className="btn sm" onClick={run} disabled={pending}>{pending ? 'Syncing…' : label}</button>
      {message && <span className="faint" style={{ fontSize: 12 }}>{message}</span>}
    </span>
  );
}
