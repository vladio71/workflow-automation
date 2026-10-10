import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CellDiagram } from '@/components/CellDiagram';
import { PatternPill } from '@/components/PatternPill';
import { CellSteps } from '@/components/CellSteps';
import { MAP, cellNeighbours, getCell, groupOf, newNodeIds, previousCell, productOf, type Cell } from '@/lib/content';
import { getCellProgress } from '@/lib/progress';

interface CellPageProps {
  params: Promise<{ cell: string }>;
}

export function generateStaticParams(): { cell: string }[] {
  return MAP.cells.map((cell) => ({ cell: cell.id }));
}

function NeighbourLink({ cell, title, arrow }: { cell: Cell | null; title: string; arrow: string }) {
  if (!cell) return <span className="nav-cell disabled">{arrow}</span>;
  return <Link href={`/map/${cell.id}`} className="nav-cell" title={`${title}: ${cell.id}`}>{arrow}</Link>;
}

export default async function CellPage({ params }: CellPageProps) {
  const { cell: cellId } = await params;
  const cell = getCell(cellId.toUpperCase());
  if (!cell) notFound();
  const product = productOf(cell);
  const group = groupOf(cell);
  const previous = previousCell(cell);
  const around = cellNeighbours(cell);
  const fresh = [...newNodeIds(cell)];
  const progress = await getCellProgress(cell.id);

  return (
    <div className="page wide">
      <p className="crumbs"><Link href="/map">Карта</Link> / {cell.id}</p>
      <div className="cell-head">
        <div>
          <div className="eyebrow mono">{cell.id} · група {group.id} «{group.name}» · {group.rps}</div>
          <h1 className="page-title" style={{ marginBottom: 10 }}>{product.name}</h1>
          <div className="scale-chips">{cell.scale.map((item) => <span key={item} className="mono">{item}</span>)}</div>
        </div>
        <div className="nav-cells" aria-label="Сусідні клітинки">
          <NeighbourLink cell={around.up} title="Менший масштаб" arrow="↑" />
          <NeighbourLink cell={around.left} title="Інший продукт" arrow="←" />
          <NeighbourLink cell={around.down} title="Більший масштаб" arrow="↓" />
          <NeighbourLink cell={around.right} title="Інший продукт" arrow="→" />
        </div>
      </div>

      <div className="pain">
        <b>{previous ? `ЩО ЗЛАМАЛОСЬ НА ГРУПІ ${previous.group}` : 'ЗВІДКИ ПОЧИНАЄМО'}</b>
        {cell.pain}
      </div>

      <CellDiagram cell={cell} lanes={MAP.lanes} newIds={fresh} glossary={MAP.glossary} />

      <div className="cols">
        <div>
          <h3 className="block-title">Шлях запиту: {cell.path.name}</h3>
          <table className="db">
            <tbody>
              {cell.path.hops.map((hop) => (
                <tr key={hop.step}><td>{hop.step}</td><td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{hop.ms} мс</td></tr>
              ))}
            </tbody>
          </table>
          <div className="total mono"><span>Разом</span><span>{cell.path.total}</span></div>
          {cell.path.note && <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>{cell.path.note}</p>}
        </div>

        <div>
          <CellSteps
            cellId={cell.id}
            progress={{
              derived: progress?.derived ?? '',
              derivedAt: progress?.derivedAt?.toISOString() ?? null,
              checkedAt: progress?.checkedAt?.toISOString() ?? null,
              summary: progress?.summary ?? '',
              summarizedAt: progress?.summarizedAt?.toISOString() ?? null,
            }}
          >
            <ul className="why">
              {cell.why.map((item, index) => (
                <li key={index}>
                  <div className="pills">{item.patterns.map((id) => <PatternPill key={id} id={id} />)}</div>
                  <div>{item.text}</div>
                </li>
              ))}
            </ul>
            {cell.notYet && <div className="box"><b className="box-key">ЩЕ НЕ ТРЕБА</b>{cell.notYet}</div>}
            {cell.example && <div className="box"><b className="box-key">{cell.example.kind.toUpperCase()}</b>{cell.example.text}</div>}
            {cell.refs.length > 0 && (
              <div className="refs">Твої діаграми і книга: {cell.refs.map((ref) => <span key={ref} className="ref">{ref}</span>)}</div>
            )}
          </CellSteps>
        </div>
      </div>
    </div>
  );
}
