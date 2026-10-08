'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { addCategory } from '@/app/actions';

export interface CategoryOption {
  id: number;
  name: string;
}

interface CategoryPickerProps {
  /** null = без категорії */
  value: number | null;
  /** усі категорії; порядок задає сервер: спершу ті, якими користувався останніми */
  categories: CategoryOption[];
  onChoose: (topicId: number | null) => void;
  /** текст, коли категорії нема */
  placeholder?: string;
  testId?: string;
}

/**
 * Вибір категорії картки: клік відкриває список наявних, "+ Add new" відкриває попап з назвою.
 * Нова категорія створюється і одразу вибирається.
 */
export function CategoryPicker({ value, categories, onChoose, placeholder = 'No category', testId = 'category-picker' }: CategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  /** категорії, створені тут: показуємо їх одразу, не чекаючи, поки сторінка перечитає список */
  const [created, setCreated] = useState<CategoryOption[]>([]);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (naming && !dialog.open) dialog.showModal();
    if (!naming && dialog.open) dialog.close();
  }, [naming]);

  const knownIds = new Set(categories.map((category) => category.id));
  const options: CategoryOption[] = [...created.filter((category) => !knownIds.has(category.id)), ...categories];
  const current = options.find((category) => category.id === value) ?? null;

  const choose = (topicId: number | null): void => {
    setOpen(false);
    onChoose(topicId);
  };

  const create = (): void => {
    if (!name.trim() || pending) return;
    startTransition(async () => {
      const category = await addCategory(name);
      if (!category) return;
      setCreated((list) => [category, ...list.filter((entry) => entry.id !== category.id)]);
      setName('');
      setNaming(false);
      onChoose(category.id);
    });
  };

  return (
    <div className="select" ref={ref} onClick={(event) => event.stopPropagation()}>
      <button type="button" className="category-trigger" data-testid={testId} title="Change category" onClick={() => setOpen((shown) => !shown)}>
        {current ? current.name : <span className="faint">{placeholder}</span>}
      </button>
      {open && (
        <div className="select-menu category-menu" data-testid={`${testId}-menu`}>
          <div className="hint">Category</div>
          {options.map((category) => (
            <button key={category.id} type="button" className="select-option" onClick={() => choose(category.id)}>
              {category.id === value ? '✓ ' : ''}{category.name}
            </button>
          ))}
          {value !== null && (
            <button type="button" className="select-option faint" onClick={() => choose(null)}>No category</button>
          )}
          <button type="button" className="select-option" data-testid={`${testId}-add`} onClick={() => { setOpen(false); setNaming(true); }}>
            + Add new
          </button>
        </div>
      )}
      <dialog ref={dialogRef} className="modal" style={{ width: 'min(420px, calc(100vw - 32px))' }} onClose={() => setNaming(false)}>
        <div className="modal-head"><h2>New category</h2></div>
        <div className="modal-body">
          {naming && (
            <input
              className="input"
              data-testid={`${testId}-name`}
              autoFocus
              value={name}
              maxLength={120}
              placeholder="Category name"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  create();
                }
              }}
            />
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn primary" data-testid={`${testId}-create`} disabled={pending || name.trim() === ''} onClick={create}>
            {pending ? 'Creating…' : 'Create and assign'}
          </button>
          <button type="button" className="btn ghost" onClick={() => setNaming(false)}>Cancel</button>
        </div>
      </dialog>
    </div>
  );
}
