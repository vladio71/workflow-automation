'use client';

import { useRef } from 'react';
import { addInbox } from '@/app/actions';

/** Quick capture into Inbox: press Enter and forget it. Inbox is sorted out on Sunday. */
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
