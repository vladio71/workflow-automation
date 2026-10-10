import { MatrixGrid } from '@/components/MatrixGrid';
import { MAP } from '@/lib/content';

export default function MapPage() {
  return (
    <div className="page wide">
      <h1 className="page-title">Карта навантажень</h1>
      <p className="page-sub">
        {MAP.products.length} продукти × {MAP.groups.length} груп навантаження. Колонка = один продукт росте (читай згори вниз).
        Рядок = однаковий масштаб, різні продукти (читай зліва направо). У клітинці: система на цьому масштабі, трафік і затримка
        на кожній стрілці, що зламалось на групі нижче і яким патерном мислення це рішення виводиться.
      </p>
      <div className="legend">
        <span><span className="chip new">помаранчеве</span> з&apos;явилось або змінилось на цій групі</span>
        <span>Блоки, які не змінились (CDN, Stripe), на схемі можуть бути не намальовані.</span>
      </div>
      <MatrixGrid />
      <h2 className="block-title">Групи навантаження</h2>
      <p className="muted" style={{ fontSize: 14, marginBottom: 8 }}>
        RPS виведено так: DAU × ~50 запитів на юзера за день ÷ 86 400 × 3 (пік). 50k DAU × 50 ÷ 86 400 ≈ 29 RPS, × 3 ≈ 90, тобто ~100.
        У продуктів свої метрики (з&apos;єднання, повідомлення, виклики LLM), вони вказані в кожній клітинці.
      </p>
      <div className="tbl-scroll">
        <table className="db">
          <thead><tr><th>Група</th><th>Пік RPS</th><th>DAU</th><th>Дані</th><th>Люди</th></tr></thead>
          <tbody>
            {MAP.groups.map((group) => (
              <tr key={group.id}>
                <td><b>{group.id} · {group.name}</b></td>
                <td className="mono">{group.rps}</td>
                <td className="mono">{group.dau}</td>
                <td className="mono">{group.data}</td>
                <td>{group.team}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
