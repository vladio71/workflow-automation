import { deleteParking, finishParking, parkingToQuestion, parkingToTopic, pickParking, unpickParking } from '../actions';
import { QuickCapture } from '@/components/QuickCapture';
import { getParking } from '@/lib/progress';
import { TRACKS } from '@/lib/labels';

export default async function ParkingPage() {
  const { open, picked, done } = await getParking();

  return (
    <div className="page">
      <h1 className="page-title">Парковка</h1>
      <p className="page-sub">
        Потягнуло в кролячу нору: питання одним рядком сюди і назад до клітинки. Раз на тиждень береш одне питання
        і робиш на нього маленький експеримент (Postgres у Docker, два процеси Node, k6 проти API).
      </p>
      <QuickCapture />

      {picked && (
        <div className="callout" style={{ marginTop: 16 }}>
          <div style={{ flex: 1 }}>
            <div className="lbl">Експеримент цього тижня</div>
            <div style={{ fontSize: 16, fontWeight: 500 }}>{picked.text}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <form action={finishParking.bind(null, picked.id)}><button className="btn sm primary">Зроблено</button></form>
              <form action={unpickParking.bind(null, picked.id)}><button className="btn sm ghost">Повернути в список</button></form>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        {open.length === 0 && !picked && <p className="faint">Парковка порожня.</p>}
        {open.map((item) => (
          <div key={item.id} className="row-hover" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 6px', borderBottom: '1px solid var(--border)', borderRadius: 4 }}>
            <div style={{ flex: 1 }}>
              <div>{item.text}</div>
              <div className="faint" style={{ fontSize: 12 }}>{item.createdAt.toLocaleString('uk-UA', { dateStyle: 'medium', timeStyle: 'short' })}</div>
            </div>
            {!picked && <form action={pickParking.bind(null, item.id)}><button className="btn sm">На експеримент</button></form>}
            <details style={{ position: 'relative' }}>
              <summary className="btn sm" style={{ listStyle: 'none' }}>→ Тема</summary>
              <div className="select-menu" style={{ right: 0, left: 'auto' }}>
                {TRACKS.map((track) => (
                  <form key={track.value} action={parkingToTopic.bind(null, item.id, track.value)}>
                    <button className="select-option"><span className={`tag ${track.color}`}>{track.label}</span></button>
                  </form>
                ))}
              </div>
            </details>
            <form action={parkingToQuestion.bind(null, item.id)}><button className="btn sm">→ Питання</button></form>
            <form action={deleteParking.bind(null, item.id)}><button className="btn sm ghost" title="Видалити">✕</button></form>
          </div>
        ))}
      </div>

      {done.length > 0 && (
        <>
          <h2 className="block-title">Зроблені експерименти</h2>
          {done.map((item) => (
            <div key={item.id} style={{ display: 'flex', gap: 8, padding: '6px', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
              <span className="muted" style={{ flex: 1 }}>{item.text}</span>
              <span className="faint mono" style={{ fontSize: 12 }}>{item.doneAt?.toLocaleDateString('uk-UA')}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
