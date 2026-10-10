import Link from 'next/link';
import { PATTERNS, cellsUsingPattern } from '@/lib/content';

export default function PatternsPage() {
  return (
    <div className="page wide">
      <h1 className="page-title">Патерни мислення</h1>
      <p className="page-sub">
        Питання, які ставиш до системи, щоб вивести рішення, а не згадувати його. На кожній клітинці карти видно, які з них спрацювали.
        Тренування: відкрий клітинку, не дивись у «Чому саме так» і спробуй вивести рішення сам по цих питаннях.
      </p>

      <h2 className="block-title">Порядок на співбесіді</h2>
      <div className="fw">
        {PATTERNS.framework.map((step, index) => (
          <div key={step.step}>
            <span className="mono faint">{index + 1} · {step.time}</span>
            <h3>{step.step}</h3>
            <p>{step.text}</p>
          </div>
        ))}
      </div>

      <h2 className="block-title">{PATTERNS.patterns.length} патернів</h2>
      <div className="pgrid">
        {PATTERNS.patterns.map((pattern) => {
          const used = cellsUsingPattern(pattern.id);
          return (
            <article key={pattern.id} className="pcard" id={pattern.id}>
              <span className="pid mono">{pattern.id}</span>
              <h3>{pattern.name}</h3>
              <p className="q">{pattern.q}</p>
              {pattern.steps.length > 0 && (
                <div>
                  <div className="lbl">Хід думки</div>
                  <ol>{pattern.steps.map((step) => <li key={step}>{step.replace(/^\d+\.\s/, '')}</li>)}</ol>
                </div>
              )}
              {pattern.formulas.length > 0 && (
                <div className="formula mono">{pattern.formulas.map((formula) => <span key={formula}>{formula}</span>)}</div>
              )}
              {pattern.answers.length > 0 && (
                <div>
                  <div className="lbl">Якщо → то</div>
                  <table className="db compact">
                    <tbody>{pattern.answers.map((answer) => <tr key={answer.when}><td>{answer.when}</td><td><b>{answer.then}</b></td></tr>)}</tbody>
                  </table>
                </div>
              )}
              {pattern.example && <p style={{ fontSize: 14 }}>{pattern.example}</p>}
              <p className="anti"><b>Антипатерн.</b> {pattern.anti}</p>
              {used.length > 0 && (
                <div>
                  <div className="lbl">Де спрацював у карті</div>
                  <div className="where">{used.map((id) => <Link key={id} href={`/map/${id}`}>{id}</Link>)}</div>
                </div>
              )}
              {pattern.refs.length > 0 && <div className="refs">{pattern.refs.map((ref) => <span key={ref} className="ref">{ref}</span>)}</div>}
            </article>
          );
        })}
      </div>
    </div>
  );
}
