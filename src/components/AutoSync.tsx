'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface SyncResponse {
  synced: number;
}

/**
 * On Today: once on open, pull the repos that have not synced in a while and refresh the page.
 * A plain fetch to /api/sync rather than a server action, so the sync does not block other buttons on the page.
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
        // network failure is fine here: the error shows on /sources after a manual Sync
      });
  }, [router]);
  return null;
}
