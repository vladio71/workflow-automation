import Link from 'next/link';
import { MINIMUM } from '@/lib/content';

export default function MinimumPage() {
  return (
    <div className="page">
      <h1 className="page-title">Сеньйорський мінімум</h1>
      <p className="page-sub">
        Те, чого карта навантажень не дає: моніторинг і алерти, поведінка в інцидентах, тестування, вміння сказати «тут свідомо простіше, бо…».
        У кожному модулі модель, патерни мислення, готова відповідь для співбесіди, твій досвід як історія і дрили з еталонами.
      </p>
      <div className="module-list">
        {MINIMUM.modules.map((module) => (
          <Link key={module.id} href={`/minimum/${module.id}`} className="module-card">
            <h3>{module.name}</h3>
            <p>{module.thesis}</p>
            <span className="mono faint">{module.patterns.length} патернів · {module.drills.length} дрилів</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
