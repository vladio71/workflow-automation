'use client';

import { useEffect, useState, useTransition } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Topic knowledge base in markdown. Click the text to edit, blur saves. */
export function NotesEditor({ value, action }: { value: string; action: (value: string) => Promise<void> }) {
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);
  const [, startTransition] = useTransition();
  useEffect(() => setText(value), [value]);

  if (editing || !text.trim()) {
    return (
      <textarea
        className="textarea mono"
        style={{ minHeight: 220, fontSize: 13.5 }}
        autoFocus={editing}
        value={text}
        placeholder={'Notes in markdown. Key ideas, diagrams in words, links.\nWrite questions in the Questions section below, not here.'}
        onChange={(event) => setText(event.target.value)}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          if (text !== value) startTransition(() => action(text));
        }}
      />
    );
  }
  return (
    <div className="md row-hover" style={{ cursor: 'text', borderRadius: 6, padding: '4px 6px', margin: '0 -6px' }} onClick={() => setEditing(true)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
