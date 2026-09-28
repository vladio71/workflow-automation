'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface SyncResponse {
  synced: number;
}

/**
 * На Today: один раз при відкритті підтягнути репо, які давно не синкались, і перемалювати сторінку.
 * Звичайний fetch до /api/sync, а не server action: так sync не блокує інші кнопки на сторінці.
 */
export function AutoSync() {
  const router = useRouter();
  useEffect(() => {
    fetch('/api/sync', { method: 'POST' })
      .then((response) => response.json() as Promise<SyncResponse>)
      .then((result) => {
        if (result.synced > 0) router.refresh();
      })
      .catch(() => {
        // мережа впала: не страшно, помилка видна на /sources після ручного Sync
      });
  }, [router]);
  return null;
}
