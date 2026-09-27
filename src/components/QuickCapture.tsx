'use client';

import { useRef } from 'react';
import { addInbox } from '@/app/actions';

/** Швидкий запис в Inbox: Enter і забув. Розбирати в неділю. */
export function QuickCapture({ placeholder = 'Capture an idea, link or "don\'t get X"... (Enter)' }: { placeholder?: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await addInbox(formData);
        formRef.current?.reset();
      }}
    >
      <input name="text" className="input" placeholder={placeholder} autoComplete="off" />
    </form>
  );
}
