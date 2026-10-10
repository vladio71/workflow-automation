import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Reveal } from '@/components/Reveal';
import { MINIMUM, getModule, type Module } from '@/lib/content';

interface ModulePageProps {
  params: Promise<{ module: string }>;
}

export function generateStaticParams(): { module: string }[] {
  return MINIMUM.modules.map((module) => ({ module: module.id }));
}

function ModuleModel({ module }: { module: Module }) {
  if (module.flow.length > 0) {
    return (
      <div className="flow">
        {module.flow.map((step) => (
          <div key={step.title} className="flow-step">
            <b>{step.title}</b>
            <span className="mono">{step.tag}</span>
            <p>{step.text}</p>
          </div>
        ))}
      </div>
    );
  }
  if (module.trophy.length > 0) {
    return (
      <>
        <div className="trophy">
          <div className="trophy-layers">
            {module.trophy.map((layer) => (
              <div key={layer.layer} className={`trophy-layer${layer.width === 100 ? ' main' : ''}`} style={{ width: `${Math.max(30, layer.width)}%` }}>
                {layer.layer}
              </div>
            ))}
          </div>
          <div className="trophy-desc">
            {module.trophy.map((layer) => (
              <div key={layer.layer}><b>{layer.layer}</b>: {layer.what}. <span className="muted">{layer.note}</span></div>
            ))}
          </div>
        </div>
        <div className="trophy-side">
          {module.side.map((item) => <div key={item.title}><b>{item.title}</b> (поруч з будь-яким шаром): {item.text}</div>)}
        </div>
        <p className="faint" style={{ fontSize: 13, marginTop: 8 }}>
          Ширина шару = скільки цінності він дає в бекенді. Найширший шар тут інтеграційні тести, а не unit, як у класичній піраміді.
        </p>
      </>
    );
  }
  if (module.decision) {
    return (
      <div className="decision">
        <div className="decision-q">Рішення. Скільки коштуватиме передумати?</div>
        <div className="decision-branches">
          <div className="decision-branch two">
            <b>ДЕШЕВО: ДВЕРІ В ДВА БОКИ</b>
            Бібліотека, черга для однієї фічі, внутрішній формат. Бери найпростіше, що закриває вимогу. Запиши тригер перегляду.
          </div>
          <div className="decision-branch one">
            <b>ДОРОГО: ДВЕРІ В ОДИН БІК</b>
            Схема даних і грошей, ключ шардування, публічний API, основна база. Порівняй 2–3 варіанти, порахуй, напиши ADR, покажи команді.
          </div>
        </div>
        <div className="formula mono">
          <span>Беру X, а не Y, бо зараз [цифра або обмеження].</span>
          <span>Ціна: [що втрачаємо].</span>
          <span>Переглянемо, коли [тригер з цифрою].</span>
        </div>
      </div>
    );
  }
  return null;
}

export default async function ModulePage({ params }: ModulePageProps) {
  const { module: moduleId } = await params;
  const module = getModule(moduleId);
  if (!module) notFound();

  return (
    <div className="page wide">
      <p className="crumbs"><Link href="/minimum">Мінімум</Link> / {module.name}</p>
      <h1 className="page-title">{module.name}</h1>
      <p className="thesis">{module.thesis}</p>

      <h2 className="block-title">Модель</h2>
      <ModuleModel module={module} />

      <h2 className="block-title">Поняття</h2>
      <div className="cgrid">
        {module.concepts.map((concept) => <div key={concept.term} className="concept"><b>{concept.term}</b><p>{concept.text}</p></div>)}
      </div>

      {module.aws.length > 0 && (
        <>
          <h2 className="block-title">Що дивитись у твоєму стеку</h2>
          <div className="tbl-scroll">
            <table className="db">
              <thead><tr><th>Де</th><th>Метрика</th><th>Як ставитись</th></tr></thead>
              <tbody>{module.aws.map((row) => <tr key={row.where}><td><b>{row.where}</b></td><td className="mono">{row.metric}</td><td>{row.how}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}

      {module.phrases.length > 0 && (
        <>
          <h2 className="block-title">Готові фрази за формулою</h2>
          <div className="cgrid">
            {module.phrases.map((phrase) => <div key={phrase.title} className="concept"><b>{phrase.title}</b><p>{phrase.text}</p></div>)}
          </div>
        </>
      )}

      <h2 className="block-title">Патерни мислення</h2>
      <div className="pgrid">
        {module.patterns.map((pattern) => (
          <article key={pattern.id} className="pcard" id={pattern.id}>
            <span className="pid mono">{pattern.id}</span>
            <h3>{pattern.name}</h3>
            <p className="q">{pattern.q}</p>
            <table className="db compact"><tbody>{pattern.ifthen.map((row) => <tr key={row.when}><td>{row.when}</td><td><b>→ {row.then}</b></td></tr>)}</tbody></table>
            <p className="anti"><b>Антипатерн.</b> {pattern.anti}</p>
          </article>
        ))}
      </div>

      <h2 className="block-title">Як це звучить на співбесіді</h2>
      <div className="say"><span className="lbl">ЕТАЛОННА ВІДПОВІДЬ, ~1 ХВ</span>{module.interview}</div>

      <h2 className="block-title">Твій досвід як історія</h2>
      <div className="exp">
        {module.experience.map((item) => (
          <div key={item.title} className={item.title === 'Важливе' ? 'imp' : ''}><b>{item.title}</b>{item.text}</div>
        ))}
      </div>

      <h2 className="block-title">Дрили</h2>
      <p className="muted" style={{ fontSize: 14, marginBottom: 12 }}>Спершу відповідай сам, потім відкривай еталон і проходь по чеклісту.</p>
      <div className="drills">
        {module.drills.map((drill, index) => (
          <div key={drill.id} className="drill" id={drill.id}>
            <span className="mono faint">{module.short} · дрил {index + 1}</span>
            <p className="drill-q">{drill.q}</p>
            <Reveal label="Показати еталон">
              <div className="ref-cols">
                <div><span className="lbl">ЕТАЛОН</span><ul>{drill.ref.map((line) => <li key={line}>{line}</li>)}</ul></div>
                <div><span className="lbl">ЧИ Є ЦЕ У ТВОЇЙ ВІДПОВІДІ</span><ul>{drill.check.map((line) => <li key={line}>{line}</li>)}</ul></div>
              </div>
            </Reveal>
          </div>
        ))}
      </div>
    </div>
  );
}
