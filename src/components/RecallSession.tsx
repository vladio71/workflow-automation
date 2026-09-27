'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { gradeRecall, saveRecall } from '@/app/actions';
import type { GradeResult } from '@/lib/gemini';

interface RecallTopic {
  id: number;
  name: string;
  notes: string;
  drill: string;
}

interface RecallQuestion {
  id: number;
  question: string;
  reference: string;
}

interface RecallSessionProps {
  topic: RecallTopic;
  questions: RecallQuestion[];
  initialQuestionId: number | null;
  geminiEnabled: boolean;
}

type FinalColor = 'RED' | 'AMBER' | 'GREEN';

const FREE_RECALL = 0;

const COLOR_BUTTONS: { value: FinalColor; label: string; hint: string; tag: string }[] = [
  { value: 'RED', label: 'Red', hint: 'stuck, back to +2d', tag: 'red' },
  { value: 'AMBER', label: 'Amber', hint: 'small gaps, same step', tag: 'orange' },
  { value: 'GREEN', label: 'Green', hint: 'clean, next step', tag: 'green' },
];

function formatFeedback(result: GradeResult): string {
  const list = (title: string, items: string[]) => (items.length ? `${title}\n${items.map((item) => `- ${item}`).join('\n')}` : '');
  return [
    `Score: ${result.score}/100`,
    list('Covered:', result.covered),
    list('Missed:', result.missed),
    list('Wrong:', result.wrong),
    `Follow-up: ${result.followUp}`,
  ].filter(Boolean).join('\n\n');
}

export function RecallSession({ topic, questions, initialQuestionId, geminiEnabled }: RecallSessionProps) {
  const router = useRouter();
  const [questionId, setQuestionId] = useState<number>(initialQuestionId ?? questions[0]?.id ?? FREE_RECALL);
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [grade, setGrade] = useState<GradeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [grading, startGrading] = useTransition();
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const question = useMemo(() => questions.find((item) => item.id === questionId) ?? null, [questions, questionId]);
  const prompt = question?.question ?? `Explain "${topic.name}" from memory: what it is, why, how it works, trade-offs.`;
  const reference = question?.reference || '';

  function check() {
    setError(null);
    startGrading(async () => {
      const response = await gradeRecall({ topic: topic.name, question: prompt, reference, notes: topic.notes, answer });
      if (response.ok) setGrade(response.result);
      else setError(response.error);
      setRevealed(true);
    });
  }

  function finish(confidence: FinalColor) {
    startSaving(async () => {
      const { nextTopicId } = await saveRecall({
        topicId: topic.id,
        questionId: question?.id ?? null,
        answer,
        feedback: grade ? formatFeedback(grade) : '',
        confidence,
        seconds,
      });
      router.push(nextTopicId ? `/recall/${nextTopicId}` : '/');
    });
  }

  const minutes = Math.floor(seconds / 60);
  const done = revealed || grade !== null;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <select
          className="input"
          style={{ maxWidth: 560 }}
          value={questionId}
          onChange={(event) => {
            setQuestionId(Number(event.target.value));
            setGrade(null);
            setRevealed(false);
          }}
        >
          {questions.map((item) => <option key={item.id} value={item.id}>{item.question}</option>)}
          <option value={FREE_RECALL}>Free recall: explain the whole topic</option>
        </select>
        <span className="faint mono">{minutes}:{String(seconds % 60).padStart(2, '0')}</span>
      </div>

      <div className="callout"><span className="emoji">❓</span><div style={{ fontWeight: 600 }}>{prompt}</div></div>
      {topic.drill && !question && (
        <p className="muted" style={{ fontSize: 14 }}>
          Drill: open an empty file and rebuild <span className="mono">{topic.drill}</span> without looking. Paste the key idea below.
        </p>
      )}

      <textarea
        className="textarea"
        style={{ minHeight: 220 }}
        placeholder="Answer from memory. Your own words. No tabs with docs open."
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        autoFocus
      />

      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        {geminiEnabled && (
          <button className="btn primary" onClick={check} disabled={grading || !answer.trim()}>
            {grading ? 'Checking…' : '✨ Check with Gemini'}
          </button>
        )}
        <button className="btn" onClick={() => setRevealed(true)}>Show reference</button>
      </div>
      {!geminiEnabled && <p className="faint" style={{ fontSize: 13 }}>Set GEMINI_API_KEY in .env to get AI feedback. Without it, compare with the reference yourself.</p>}
      {error && <div className="callout" style={{ color: '#eb5757' }}><span className="emoji">⚠️</span><div>{error}</div></div>}

      {grade && (
        <div className="card" style={{ margin: '12px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <b>Gemini feedback</b>
            <span className="mono">{grade.score}/100 · suggests <span className={`tag ${COLOR_BUTTONS.find((c) => c.value === grade.suggested)?.tag}`}>{grade.suggested.toLowerCase()}</span></span>
          </div>
          <FeedbackList title="✅ Covered" items={grade.covered} />
          <FeedbackList title="🕳️ Missed" items={grade.missed} />
          <FeedbackList title="❌ Wrong" items={grade.wrong} />
          <div style={{ marginTop: 10 }}><span className="faint" style={{ fontSize: 12 }}>Interviewer follow-up</span><div style={{ fontWeight: 500 }}>{grade.followUp}</div></div>
        </div>
      )}

      {revealed && (
        <div className="card" style={{ margin: '12px 0' }}>
          <b>Reference</b>
          {reference ? (
            <div className="md" style={{ marginTop: 4 }}><ReactMarkdown remarkPlugins={[remarkGfm]}>{reference}</ReactMarkdown></div>
          ) : (
            <p className="faint" style={{ fontSize: 14 }}>No reference for this question yet. Fill it on the topic page after checking the source.</p>
          )}
          {topic.notes && (
            <details style={{ marginTop: 8 }}>
              <summary className="faint" style={{ cursor: 'pointer', fontSize: 13 }}>Topic notes</summary>
              <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{topic.notes}</ReactMarkdown></div>
            </details>
          )}
        </div>
      )}

      {done && (
        <>
          <h3 className="block-title">How did it go? You decide the color.</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {COLOR_BUTTONS.map((color) => (
              <button key={color.value} className="btn" disabled={saving} onClick={() => finish(color.value)}>
                <span className={`tag ${color.tag}`}>{color.label}</span>
                <span className="faint" style={{ fontSize: 13 }}>{color.hint}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FeedbackList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
      <ul style={{ margin: '2px 0 0 18px', listStyle: 'disc', fontSize: 14 }}>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}
