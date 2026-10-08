'use client';

import { useEffect, useRef, useState, useTransition, type DragEvent, type KeyboardEvent } from 'react';
import { addDailyItem, checkDailyItem, removeDailyItem, saveDailyItemTitle, saveDailyOrder } from '@/app/actions';

export interface DailyListItem {
  id: number;
  title: string;
  checked: boolean;
  /** галочку цього пункту апка ставить і сама (картки, recall) */
  auto: boolean;
}

interface DropTarget {
  id: number;
  /** лінія вставки над пунктом чи під ним */
  below: boolean;
}

/**
 * Daily як to-do в Notion: клік по тексту = правка, Enter = новий пункт нижче,
 * Backspace у порожньому = видалити, ручка зліва = перетягнути.
 * Список після завантаження живе тут: правки одразу видно, сервер тільки зберігає.
 */
export function DailyList({ items: initial }: { items: DailyListItem[] }) {
  const [items, setItems] = useState<DailyListItem[]>(initial);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const inputs = useRef(new Map<number, HTMLInputElement>());
  /** назви, як вони збережені на сервері: щоб не зберігати те саме двічі */
  const saved = useRef(new Map<number, string>(initial.map((item) => [item.id, item.title])));

  // сервер перемалював сторінку (галочка, план дня): беремо його список, якщо зараз нічого не редагується
  useEffect(() => {
    if (listRef.current?.contains(document.activeElement)) return;
    setItems(initial);
    saved.current = new Map(initial.map((item) => [item.id, item.title]));
  }, [initial]);

  useEffect(() => {
    if (focusId === null) return;
    inputs.current.get(focusId)?.focus();
    setFocusId(null);
  }, [focusId, items]);

  const toggle = (item: DailyListItem): void => {
    const checked = !item.checked;
    setItems((list) => list.map((entry) => (entry.id === item.id ? { ...entry, checked } : entry)));
    startTransition(() => checkDailyItem(item.id, checked));
  };

  const rename = (id: number, title: string): void => {
    setItems((list) => list.map((entry) => (entry.id === id ? { ...entry, title } : entry)));
  };

  const save = (item: DailyListItem): void => {
    if (saved.current.get(item.id) === item.title) return;
    saved.current.set(item.id, item.title);
    startTransition(() => saveDailyItemTitle(item.id, item.title));
  };

  const add = (afterId: number | null): void => {
    startTransition(async () => {
      const id = await addDailyItem(afterId, '');
      saved.current.set(id, '');
      setItems((list) => {
        const index = afterId === null ? -1 : list.findIndex((entry) => entry.id === afterId);
        const copy = [...list];
        copy.splice(index === -1 ? list.length : index + 1, 0, { id, title: '', checked: false, auto: false });
        return copy;
      });
      setFocusId(id);
    });
  };

  const remove = (id: number, focusPrevious: boolean): void => {
    const index = items.findIndex((entry) => entry.id === id);
    if (index === -1) return;
    const neighbour = items[index - 1] ?? items[index + 1];
    setItems((list) => list.filter((entry) => entry.id !== id));
    saved.current.delete(id);
    if (focusPrevious && neighbour) setFocusId(neighbour.id);
    startTransition(() => removeDailyItem(id));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, item: DailyListItem): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      save(item);
      add(item.id);
    } else if (event.key === 'Backspace' && item.title === '') {
      event.preventDefault();
      remove(item.id, true);
    } else if (event.key === 'Escape') {
      event.currentTarget.blur();
    }
  };

  // порожній пункт, з якого пішли, не лишаємо: інакше список обростає порожніми рядками
  const onBlur = (item: DailyListItem): void => {
    if (item.title.trim() === '') remove(item.id, false);
    else save(item);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>, item: DailyListItem): void => {
    if (dragId === null) return;
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    setDrop({ id: item.id, below: event.clientY > box.top + box.height / 2 });
  };

  const onDrop = (): void => {
    const target = drop;
    const moving = dragId;
    setDragId(null);
    setDrop(null);
    if (target === null || moving === null || target.id === moving) return;
    const moved = items.find((entry) => entry.id === moving);
    if (!moved) return;
    const rest = items.filter((entry) => entry.id !== moving);
    const targetIndex = rest.findIndex((entry) => entry.id === target.id);
    if (targetIndex === -1) return;
    rest.splice(target.below ? targetIndex + 1 : targetIndex, 0, moved);
    setItems(rest);
    const order = rest.map((entry) => entry.id);
    startTransition(() => saveDailyOrder(order));
  };

  return (
    <div ref={listRef} className="daily-list" data-testid="daily-list">
      {items.map((item) => {
        const line = drop !== null && drop.id === item.id && dragId !== item.id ? (drop.below ? 'drop-below' : 'drop-above') : '';
        return (
          <div
            key={item.id}
            className={`daily-row ${item.checked ? 'on' : ''} ${dragId === item.id ? 'dragging' : ''} ${line}`}
            data-testid={`daily-item-${item.id}`}
            onDragOver={(event) => onDragOver(event, item)}
            onDrop={onDrop}
          >
            <span
              className="grip"
              draggable
              title="Drag to reorder"
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', String(item.id));
                setDragId(item.id);
              }}
              onDragEnd={() => { setDragId(null); setDrop(null); }}
            >⋮⋮</span>
            <span className="box" role="checkbox" aria-checked={item.checked} data-testid={`daily-check-${item.id}`} onClick={() => toggle(item)}>
              {item.checked && (
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.2">
                  <path d="M2 6.5l2.5 2.5L10 3.5" />
                </svg>
              )}
            </span>
            <input
              ref={(element) => {
                if (element) inputs.current.set(item.id, element);
                else inputs.current.delete(item.id);
              }}
              className="bare daily-title"
              value={item.title}
              maxLength={300}
              placeholder="To-do"
              onChange={(event) => rename(item.id, event.target.value)}
              onKeyDown={(event) => onKeyDown(event, item)}
              onBlur={() => onBlur(item)}
            />
            {item.auto && <span className="faint daily-auto" title="The app ticks this one by itself">auto</span>}
            <button type="button" className="btn sm ghost daily-remove" title="Delete" aria-label="Delete item" onClick={() => remove(item.id, false)}>✕</button>
          </div>
        );
      })}
      <button type="button" className="daily-new" data-testid="daily-add" onClick={() => add(null)}>+ New item</button>
    </div>
  );
}
