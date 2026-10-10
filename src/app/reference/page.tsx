import { DbDiagram, LatencyLadder, ScalerTag } from '@/components/ReferenceDiagrams';
import { MINIMUM, REFERENCE } from '@/lib/content';

export default function ReferencePage() {
  return (
    <div className="page wide">
      <h1 className="page-title">Довідник</h1>
      <p className="page-sub">
        Цифри для бюджету затримки, ліміти AWS і те, як масштабується кожна база: що вона робить сама, а що робиш ти.
        Перевірено по документації станом на жовтень 2026. <span className="mono">оцінка</span> = точної офіційної цифри нема.
      </p>

      <h2 className="block-title" id="latency">Затримки</h2>
      <p className="muted" style={{ fontSize: 14, marginBottom: 8 }}>Логарифмічна шкала: кожна поділка ×10. Смуга = діапазон. Пунктир = оцінка без офіційного джерела.</p>
      <LatencyLadder bars={REFERENCE.latency} />

      <h2 className="block-title" id="db">Масштаб баз</h2>
      <p className="muted" style={{ fontSize: 14, marginBottom: 8 }}>
        Блоки: темний = пише, світлий = читає, сірий = маршрутизує, фіолетовий = шард або партиція.
        Мітки: <ScalerTag who="САМ" /> автоматично, <ScalerTag who="ТИ" /> руками, <ScalerTag who="НАЛАШТУЄШ" /> автоматично в межах твоїх налаштувань.
      </p>
      <div className="dbgrid">
        {REFERENCE.dbs.map((db) => (
          <div key={db.name} className="dbcard">
            <h3>{db.name}</h3>
            <div className="tbl-scroll"><DbDiagram data={db} /></div>
            <table className="db compact">
              <tbody>
                {db.tags.map((tag) => (
                  <tr key={tag.what}><td style={{ width: 80 }}>{tag.what}</td><td style={{ width: 110 }}><ScalerTag who={tag.who} /></td><td>{tag.text}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="trap">Пастка: {db.trap}</p>
          </div>
        ))}
      </div>

      <h2 className="block-title" id="aws">AWS: що це, ліміти і хто скейлить</h2>
      <div className="awsgrid">
        {REFERENCE.aws.map((card) => (
          <div key={card.name} className="awscard">
            <div className="awscard-head"><h3>{card.name}</h3><span className="faint" style={{ fontSize: 12 }}>скейлить:</span> <ScalerTag who={card.scaler.who} /></div>
            <p className="muted">{card.what}</p>
            <div className="badges">
              {card.badges.map((badge) => <div key={badge.value + badge.caption} className="badge"><b className="mono">{badge.value}</b><span>{badge.caption}</span></div>)}
            </div>
            {card.scaler.text && <p className="scaler-text">→ {card.scaler.text}</p>}
            {card.note && <p className="muted" style={{ fontSize: 13 }}>{card.note}</p>}
          </div>
        ))}
      </div>

      <h2 className="block-title" id="limits">Ліміти детально</h2>
      <div className="tbl-scroll">
        <table className="db">
          <thead><tr><th>Сервіс</th><th>Що це і головні ліміти</th><th>Масштабування</th><th>Важливо знати</th></tr></thead>
          <tbody>{REFERENCE.limits.map((row) => <tr key={row.service}><td><b>{row.service}</b></td><td>{row.what}</td><td>{row.scaling || '—'}</td><td>{row.note || '—'}</td></tr>)}</tbody>
        </table>
      </div>

      <h2 className="block-title" id="dbscale">Масштаб баз у таблиці</h2>
      <div className="tbl-scroll">
        <table className="db">
          <thead><tr><th>База</th><th>Читання</th><th>Запис</th><th>Обсяг</th><th>Класична пастка</th></tr></thead>
          <tbody>{REFERENCE.dbscale.map((row) => <tr key={row.db}><td><b>{row.db}</b></td><td>{row.reads}</td><td>{row.writes}</td><td>{row.storage}</td><td>{row.trap}</td></tr>)}</tbody>
        </table>
      </div>

      <h2 className="block-title" id="numbers">Цифри в таблиці</h2>
      <div className="tbl-scroll">
        <table className="db">
          <thead><tr><th>Що</th><th>Операція</th><th>Затримка</th><th>Звідки цифра</th></tr></thead>
          <tbody>
            {REFERENCE.numbers.map((row) => (
              <tr key={row.op}><td>{row.area}</td><td>{row.op}</td><td className="mono">{row.value}</td><td>{row.source}{row.estimate ? <span className="mono faint"> · оцінка</span> : null}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="block-title" id="sources">Позначки і джерела</h2>
      <div className="srcs">
        {REFERENCE.refs.map((ref) => <div key={ref.key}><span className="ref">{ref.key}</span> {ref.text}</div>)}
      </div>
      <h3 className="block-title">Карта і патерни</h3>
      <div className="srcs">
        {REFERENCE.sources.map((source) => (
          <div key={source.url}>{source.title}: {source.url.startsWith('http') ? <a href={source.url} target="_blank" rel="noreferrer">{source.url}</a> : <span className="muted">{source.url}</span>}</div>
        ))}
      </div>
      <h3 className="block-title">Сеньйорський мінімум</h3>
      <div className="srcs">
        {MINIMUM.sources.map((source) => <div key={source.url}>{source.title}: <a href={source.url} target="_blank" rel="noreferrer">{source.url}</a></div>)}
      </div>
    </div>
  );
}
