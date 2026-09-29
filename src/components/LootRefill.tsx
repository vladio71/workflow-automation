'use client';

import { useEffect } from 'react';

/** На Today: тихо докинути картки в пул скрині (сервер сам вирішує, чи вже час). Помилки видно на /loot. */
export function LootRefill() {
  useEffect(() => {
    fetch('/api/loot', { method: 'POST' }).catch(() => {
      // мережа впала: пул просто не поповниться до наступного відкриття
    });
  }, []);
  return null;
}
