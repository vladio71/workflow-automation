'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type { Option } from '@/lib/labels';

interface SelectProps<T extends string> {
  value: T | null;
  options: readonly Option<T>[];
  /** Server action already bound to the record id (.bind in the server component). */
  action: (value: T) => Promise<void>;
  placeholder?: string;
}

/** Notion-style select: clicking the pill opens a list of colored options. */
export function Select<T extends string>({ value, options, action, placeholder = 'Empty' }: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [optimistic, setOptimistic] = useState<T | null>(value);
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setOptimistic(value), [value]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const current = options.find((option) => option.value === optimistic);

  function choose(next: T) {
    setOpen(false);
    setOptimistic(next);
    startTransition(() => action(next));
  }

  return (
    <div className="select" ref={ref}>
      <div className="select-trigger" onClick={() => setOpen((v) => !v)}>
        {current ? <span className={`tag ${current.color}`}>{current.label}</span> : <span className="faint">{placeholder}</span>}
      </div>
      {open && (
        <div className="select-menu">
          <div className="hint">Select an option</div>
          {options.map((option) => (
            <button key={option.value} className="select-option" onClick={() => choose(option.value)}>
              <span className={`tag ${option.color}`}>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
