'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { autoSync } from '@/app/actions';

/** На Today: один раз при відкритті підтягнути репо, які давно не синкались, і перемалювати сторінку. */
export function AutoSync() {
  const router = useRouter();
  useEffect(() => {
    autoSync()
      .then((synced) => {
        if (synced > 0) router.refresh();
      })
      .catch(() => {
        // мережа впала: не страшно, помилка видна на /sources після ручного Sync
      });
  }, [router]);
  return null;
}
