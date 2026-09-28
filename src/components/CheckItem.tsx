'use client';

import { useEffect, useState, useTransition } from 'react';

interface CheckItemProps {
  checked: boolean;
  label: React.ReactNode;
  action: (value: boolean) => Promise<void>;
  /** Закреслювати виконане (для чекліста дня так, для прапорців-налаштувань ні). */
  strike?: boolean;
}

export function CheckItem({ checked, label, action, strike = true }: CheckItemProps) {
  const [on, setOn] = useState(checked);
  const [, startTransition] = useTransition();
  useEffect(() => setOn(checked), [checked]);

  return (
    <div
      className={`check ${on ? 'on' : ''} ${strike ? 'strike' : ''}`}
      onClick={() => {
        const next = !on;
        setOn(next);
        startTransition(() => action(next));
      }}
    >
      <span className="box">
        {on && (
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.2">
            <path d="M2 6.5l2.5 2.5L10 3.5" />
          </svg>
        )}
      </span>
      <span className="label">{label}</span>
    </div>
  );
}
