'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkGlossary } from '@/lib/remark-glossary';

/** Same shape as GlossaryEntry in lib/glossary (that file is server-only). */
export interface GlossaryTermView {
  id: number;
  topicId: number | null;
  term: string;
  aliases: string[];
  definition: string;
}

const GlossaryContext = createContext<GlossaryTermView[]>([]);

export function GlossaryProvider({ terms, children }: { terms: GlossaryTermView[]; children: ReactNode }) {
  return <GlossaryContext.Provider value={terms}>{children}</GlossaryContext.Provider>;
}

/** Definition inside the tooltip: block tags become spans so the tooltip can sit inside a <p>. */
function Definition({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children: inner }) => <span className="gloss-line">{inner}</span>,
        ul: ({ children: inner }) => <span className="gloss-line">{inner}</span>,
        ol: ({ children: inner }) => <span className="gloss-line">{inner}</span>,
        li: ({ children: inner }) => <span className="gloss-line">• {inner}</span>,
        pre: ({ children: inner }) => <span className="gloss-line gloss-pre">{inner}</span>,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

function Term({ entry, children }: { entry: GlossaryTermView; children: ReactNode }) {
  return (
    <span className="gloss" tabIndex={0} data-testid={`gloss-${entry.id}`}>
      {children}
      <span className="gloss-tip" role="tooltip">
        <b className="gloss-line">{entry.term}</b>
        <Definition>{entry.definition}</Definition>
      </span>
    </span>
  );
}

/**
 * Markdown for card answers: glossary terms of the card's category (and the global ones)
 * are underlined, hover or tap shows the explanation.
 */
export function CardMarkdown({ children, topicId }: { children: string; topicId: number | null }) {
  const all = useContext(GlossaryContext);
  const terms = useMemo(() => all.filter((entry) => entry.topicId === null || entry.topicId === topicId), [all, topicId]);
  const byId = useMemo(() => new Map(terms.map((entry) => [entry.id, entry])), [terms]);

  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkGlossary, { terms }]]}
        components={{
          span: ({ node: _node, children: inner, ...rest }) => {
            const raw = (rest as Record<string, unknown>)['data-term-id'];
            const entry = raw === undefined ? undefined : byId.get(Number(raw));
            return entry ? <Term entry={entry}>{inner}</Term> : <span {...rest}>{inner}</span>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** Whole glossary of a category, for its page. */
export function GlossaryList({ terms }: { terms: GlossaryTermView[] }) {
  return (
    <dl className="gloss-list" data-testid="glossary-list">
      {terms.map((entry) => (
        <div key={entry.id} className="gloss-item">
          <dt>
            {entry.term}
            {entry.aliases.length > 0 && <span className="faint" style={{ fontWeight: 400 }}> · {entry.aliases.join(', ')}</span>}
            {entry.topicId === null && <span className="tag" style={{ marginLeft: 6 }}>global</span>}
          </dt>
          <dd className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.definition}</ReactMarkdown></dd>
        </div>
      ))}
    </dl>
  );
}
