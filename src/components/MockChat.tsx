'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatMessage {
  role: 'USER' | 'MODEL';
  content: string;
}

const INTERVIEW_MS = 45 * 60 * 1000;

export function MockChat({ sessionId, startedAt, initial }: { sessionId: number; startedAt: string; initial: ChatMessage[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const bottomRef = useRef<HTMLDivElement>(null);
  const started = useRef(initial.length > 0);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages]);

  async function send(text: string) {
    setBusy(true);
    setMessages((prev) => [...prev, { role: 'USER', content: text || "Hi, I'm ready. Let's start." }, { role: 'MODEL', content: '' }]);
    const response = await fetch(`/api/mock/${sessionId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    while (reader) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      // append the chunk to the last (initially empty) model message
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last) copy[copy.length - 1] = { ...last, content: last.content + chunk };
        return copy;
      });
    }
    setBusy(false);
  }

  useEffect(() => {
    if (!started.current) {
      started.current = true;
      void send('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const left = Math.max(0, INTERVIEW_MS - (now - new Date(startedAt).getTime()));
  const minutes = Math.floor(left / 60000);
  const ended = messages.some((message) => message.role === 'USER' && message.content === 'END');

  return (
    <div>
      <div className="muted" style={{ display: 'flex', justifyContent: 'space-between', margin: '4px 0 16px', fontSize: 14 }}>
        <span>Requirements → estimates → API → data model → high level → deep dives</span>
        <span className="mono" style={{ color: left === 0 ? '#eb5757' : undefined }}>
          {minutes}:{String(Math.floor((left % 60000) / 1000)).padStart(2, '0')} left
        </span>
      </div>

      {messages.map((message, index) => (
        <div key={index} className="chat-msg">
          <div className="who">{message.role === 'USER' ? 'You' : 'Interviewer'}</div>
          {message.role === 'MODEL' ? (
            <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || '…'}</ReactMarkdown></div>
          ) : (
            <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
          )}
        </div>
      ))}
      <div ref={bottomRef} />

      {!ended && (
        <form
          style={{ marginTop: 16 }}
          onSubmit={(event) => {
            event.preventDefault();
            if (!input.trim() || busy) return;
            const text = input.trim();
            setInput('');
            void send(text);
          }}
        >
          <textarea
            className="textarea"
            style={{ minHeight: 90 }}
            placeholder="Your answer… (Ctrl+Enter to send, END to finish and get feedback)"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) event.currentTarget.form?.requestSubmit();
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn primary" disabled={busy}>{busy ? 'Interviewer is typing…' : 'Send'}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => void send('END')}>End & get feedback</button>
          </div>
        </form>
      )}
    </div>
  );
}
