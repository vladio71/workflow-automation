'use client';

import { useRef, useState, useTransition } from 'react';
import { addActivity } from '@/app/actions';
import { ACTIVITY_KINDS, TRACKS } from '@/lib/labels';
import type { ActivityKind } from '@/generated/prisma/enums';

interface LogTimeProps {
  /** Set when the form is on a topic page: the topic is known, so the topic list is hidden. */
  topicId?: number;
  topics?: { id: number; name: string }[];
}

const QUICK_MINUTES: readonly number[] = [15, 30, 45, 60, 90];

/** Log time in 2 clicks: how many minutes plus what was done. Topic or track are optional. */
export function LogTime({ topicId, topics = [] }: LogTimeProps) {
  const [minutes, setMinutes] = useState(30);
  const [kind, setKind] = useState<ActivityKind>('STUDY');
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      className="card"
      style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px' }}
      action={(formData) => {
        startTransition(async () => {
          await addActivity(formData);
          setSaved(`+${minutes} min logged`);
          formRef.current?.reset();
          setTimeout(() => setSaved(null), 2500);
        });
      }}
    >
      <input type="hidden" name="minutes" value={minutes} />
      <input type="hidden" name="kind" value={kind} />
      {topicId !== undefined && <input type="hidden" name="topicId" value={topicId} />}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="faint" style={{ fontSize: 13, width: 64 }}>Time</span>
        {QUICK_MINUTES.map((value) => (
          <button type="button" key={value} className="btn sm" onClick={() => setMinutes(value)}
            style={minutes === value ? { background: 'var(--active)', borderColor: 'var(--text)' } : undefined}>
            {value}m
          </button>
        ))}
        <input className="input" type="number" min={1} max={720} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}
          style={{ width: 80, height: 24, padding: '0 6px' }} aria-label="Minutes" />
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="faint" style={{ fontSize: 13, width: 64 }}>What</span>
        {ACTIVITY_KINDS.filter((option) => option.value !== 'RECALL' && option.value !== 'MOCK').map((option) => (
          <button type="button" key={option.value} onClick={() => setKind(option.value)}
            style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', opacity: kind === option.value ? 1 : 0.45 }}>
            <span className={`tag ${option.color}`}>{option.label}</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {topicId === undefined && (
          <>
            <select name="topicId" className="input" style={{ width: 240, flexShrink: 0 }} defaultValue="">
              <option value="">No topic</option>
              {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
            </select>
            <select name="track" className="input" style={{ width: 150, flexShrink: 0 }} defaultValue="">
              <option value="">Track: auto</option>
              {TRACKS.map((track) => <option key={track.value} value={track.value}>{track.label}</option>)}
            </select>
          </>
        )}
        <input name="note" className="input" placeholder="Note (optional)" autoComplete="off" />
        <button className="btn primary" disabled={pending || minutes <= 0}>{pending ? 'Saving…' : 'Log'}</button>
      </div>
      {saved && <span style={{ fontSize: 13, color: 'var(--accent)' }}>✓ {saved}</span>}
    </form>
  );
}
