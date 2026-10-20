/**
 * Remark plugin: wraps the first occurrence of each glossary term in a card answer into
 * <span data-term-id="…">, which CardMarkdown renders as an underlined term with a hover tooltip.
 * Code (``` blocks and `inline`), links and headings stay untouched.
 */

export interface GlossaryMatchTerm {
  id: number;
  term: string;
  aliases: string[];
}

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
}

const SKIP = new Set(['code', 'inlineCode', 'link', 'linkReference', 'heading', 'image', 'html']);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** One regex over all spellings, longest first so "ANN index" wins over "ANN". */
function buildMatcher(terms: GlossaryMatchTerm[]): { regex: RegExp; byKey: Map<string, number> } | null {
  const byKey = new Map<string, number>();
  for (const term of terms) {
    for (const spelling of [term.term, ...term.aliases]) {
      const key = spelling.trim().toLowerCase();
      if (key && !byKey.has(key)) byKey.set(key, term.id);
    }
  }
  if (byKey.size === 0) return null;
  const alternatives = [...byKey.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  // letters/digits around the match mean it is part of another word
  const regex = new RegExp(`(?<![\\p{L}\\p{N}_])(${alternatives.join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  return { regex, byKey };
}

export function remarkGlossary(options: { terms: GlossaryMatchTerm[] }) {
  return (tree: MdNode): void => {
    const matcher = buildMatcher(options.terms);
    if (!matcher) return;
    const used = new Set<number>();

    const splitText = (value: string): MdNode[] => {
      const out: MdNode[] = [];
      let last = 0;
      matcher.regex.lastIndex = 0;
      for (const match of value.matchAll(matcher.regex)) {
        const text = match[0];
        const id = matcher.byKey.get(text.toLowerCase());
        if (id === undefined || used.has(id)) continue;
        used.add(id);
        const start = match.index ?? 0;
        if (start > last) out.push({ type: 'text', value: value.slice(last, start) });
        out.push({
          type: 'emphasis',
          data: { hName: 'span', hProperties: { dataTermId: id } },
          children: [{ type: 'text', value: text }],
        });
        last = start + text.length;
      }
      if (out.length === 0) return [{ type: 'text', value }];
      if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
      return out;
    };

    const walk = (node: MdNode): void => {
      if (!node.children || SKIP.has(node.type)) return;
      const next: MdNode[] = [];
      for (const child of node.children) {
        if (child.type === 'text' && child.value) next.push(...splitText(child.value));
        else {
          walk(child);
          next.push(child);
        }
      }
      node.children = next;
    };
    walk(tree);
  };
}
