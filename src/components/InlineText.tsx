'use client';

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from 'react';

interface InlineTextProps {
  value: string;
  action: (value: string) => Promise<void>;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
}

/** Text edited in place and saved on blur, Notion-style. */
export function InlineText({ value, action, placeholder = 'Empty', className = '', multiline = false }: InlineTextProps) {
  const [text, setText] = useState(value);
  const [, startTransition] = useTransition();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(value), [value]);

  // the textarea grows with its text, like a Notion block
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = '0px';
    area.style.height = `${area.scrollHeight}px`;
  }, [text]);

  function save() {
    if (text !== value) startTransition(() => action(text));
  }

  if (multiline) {
    return (
      <textarea
        ref={areaRef}
        className={`bare ${className}`}
        value={text}
        placeholder={placeholder}
        rows={1}
        style={{ resize: 'none', overflow: 'hidden', display: 'block' }}
        onChange={(event) => setText(event.target.value)}
        onBlur={save}
      />
    );
  }
  return (
    <input
      className={`bare ${className}`}
      value={text}
      placeholder={placeholder}
      onChange={(event) => setText(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}
