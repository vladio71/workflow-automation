import Link from 'next/link';
import { MAP, getCell, newNodeIds, type Cell } from '@/lib/content';

export interface CellMark {
  /** скільки з трьох кроків клітинки закрито (0..3) */
  steps: number;
}

interface MatrixGridProps {
  /** прогрес по клітинках, ключ = id клітинки; без нього матриця тільки для читання */
  marks?: Record<string, CellMark>;
  /** клітинка, підсвічена як поточна (наприклад, сьогоднішня) */
  currentId?: string | null;
}

function chips(cell: Cell): { label: string; isNew: boolean }[] {
  const fresh = newNodeIds(cell);
  const added = cell.nodes.filter((node) => fresh.has(node.id));
  if (added.length > 0) return added.slice(0, 5).map((node) => ({ label: node.label, isNew: true }));
  return cell.nodes.filter((node) => node.lane > 0).slice(0, 5).map((node) => ({ label: node.label, isNew: false }));
}

/** Матриця 5 груп × 4 продукти. Колонка = продукт росте, рядок = однаковий масштаб у різних продуктів. */
export function MatrixGrid({ marks = {}, currentId = null }: MatrixGridProps) {
  return (
    <div className="mx-scroll">
      <div className="mx">
        <div />
        {MAP.products.map((product) => (
          <div key={product.id} className="mx-head">
            <strong>{product.name}</strong>
            <span>{product.sub}</span>
          </div>
        ))}
        {MAP.groups.map((group) => (
          <MatrixRow key={group.id} groupId={group.id} marks={marks} currentId={currentId} />
        ))}
      </div>
    </div>
  );
}

function MatrixRow({ groupId, marks, currentId }: { groupId: string; marks: Record<string, CellMark>; currentId: string | null }) {
  const group = MAP.groups.find((entry) => entry.id === groupId);
  if (!group) return null;
  return (
    <>
      <div className="mx-group">
        <strong>{group.id} · {group.name}</strong>
        <span className="mono">{group.rps}</span>
        <span className="mono">{group.dau}</span>
      </div>
      {MAP.products.map((product) => {
        const cell = getCell(`${product.id}${group.id}`);
        if (!cell) return <div key={product.id} />;
        const mark = marks[cell.id];
        const done = mark ? mark.steps : 0;
        const classes = ['mx-cell', done === 3 ? 'done' : '', currentId === cell.id ? 'current' : ''].join(' ');
        return (
          <Link key={cell.id} href={`/map/${cell.id}`} className={classes}>
            <span className="mx-cell-head">
              <span className="mono faint">{cell.id}</span>
              {mark && <span className="mono faint">{done}/3</span>}
            </span>
            <span className="mx-cell-scale">{cell.scale[0]}</span>
            <span className="chips">
              {chips(cell).map((chip) => (
                <span key={chip.label} className={`chip${chip.isNew ? ' new' : ''}`}>{chip.label}</span>
              ))}
            </span>
          </Link>
        );
      })}
    </>
  );
}
