'use client';

import { useState, type ReactNode } from 'react';

interface RevealProps {
  /** напис на кнопці, поки сховано */
  label: string;
  /** напис, коли відкрито */
  hideLabel?: string;
  /** одне речення під кнопкою: навіщо спершу думати самому */
  hint?: string;
  children: ReactNode;
}

/** Еталон за кнопкою: спершу виводиш сам, потім відкриваєш і звіряєш. */
export function Reveal({ label, hideLabel = 'Сховати', hint, children }: RevealProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="reveal">
      <div className="reveal-bar">
        <button type="button" className={`btn ${open ? '' : 'primary'}`} onClick={() => setOpen((value) => !value)}>
          {open ? hideLabel : label}
        </button>
        {hint && !open && <span className="faint" style={{ fontSize: 13 }}>{hint}</span>}
      </div>
      {open && <div className="reveal-body">{children}</div>}
    </div>
  );
}
