'use client';

import { useRef } from 'react';
import { addParking } from '@/app/actions';

/** Швидкий запис на парковку: питання з кролячої нори одним рядком, Enter і назад до клітинки. */
export function QuickCapture({ placeholder = 'Питання на парковку: «а як Kafka тримає порядок?» (Enter)' }: { placeholder?: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await addParking(formData);
        formRef.current?.reset();
      }}
    >
      <input name="text" className="input" placeholder={placeholder} autoComplete="off" />
    </form>
  );
}
