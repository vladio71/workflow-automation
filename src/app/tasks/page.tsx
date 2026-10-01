import { createTask, deleteTask, setTaskDone } from '../actions';
import { db } from '@/lib/db';
import type { Task, TaskRepeat } from '@/generated/prisma/client';

const REPEAT_LABEL: Record<TaskRepeat, string> = {
  ONCE: 'один раз',
  DAILY: 'щодня',
  WEEKDAYS: 'по буднях',
};

const ROW_STYLE = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 6px', borderBottom: '1px solid var(--border)', borderRadius: 4 } as const;

function dateLabel(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function TaskRow({ task }: { task: Task }) {
  const once = task.repeat === 'ONCE';
  const done = task.doneAt !== null;
  return (
    <div className="row-hover" style={ROW_STYLE}>
      {once && (
        <form action={setTaskDone.bind(null, task.id, !done)}>
          <button className={`check ${done ? 'on' : ''}`} style={{ background: 'none', border: 0, padding: 0 }} title={done ? 'Повернути' : 'Зроблено'}>
            <span className="box">
              {done && <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.2"><path d="M2 6.5l2.5 2.5L10 3.5" /></svg>}
            </span>
          </button>
        </form>
      )}
      <div style={{ flex: 1 }}>
        <div style={{ textDecoration: done ? 'line-through' : 'none', color: done ? 'var(--faint)' : undefined }}>{task.title}</div>
        <div className="faint" style={{ fontSize: 12 }}>
          {task.minutes} min · {REPEAT_LABEL[task.repeat]}
          {once && (done && task.doneAt ? ` · зроблено ${dateLabel(task.doneAt)}` : ` · з ${dateLabel(task.createdAt)}`)}
        </div>
      </div>
      <form action={deleteTask.bind(null, task.id)}><button className="btn sm ghost" title="Видалити">✕</button></form>
    </div>
  );
}

export default async function TasksPage() {
  const tasks = await db.task.findMany({ orderBy: { createdAt: 'asc' } });
  const recurring = tasks.filter((task) => task.repeat !== 'ONCE');
  const open = tasks.filter((task) => task.repeat === 'ONCE' && task.doneAt === null);
  const done = tasks
    .filter((task) => task.repeat === 'ONCE' && task.doneAt !== null)
    .sort((a, b) => (b.doneAt?.getTime() ?? 0) - (a.doneAt?.getTime() ?? 0))
    .slice(0, 15);

  return (
    <div className="page">
      <div className="page-icon">📌</div>
      <h1 className="page-title">Tasks</h1>
      <p className="page-sub">
        Справи поза навчанням. Повторювані (щодня, по буднях) план дня бере сам. Разові пропонує, поки не зробиш,
        і пише, скільки днів справа вже висить.
      </p>

      <form action={createTask} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input className="input" name="title" required maxLength={200} placeholder="Розіслати резюме, залити апку і бота на сервер…" style={{ flex: 1, minWidth: 240, height: 30 }} />
        <input className="input" name="minutes" type="number" min={5} max={480} step={5} defaultValue={30} style={{ width: 76, height: 30 }} />
        <span className="faint" style={{ fontSize: 13 }}>min</span>
        <select className="input" name="repeat" defaultValue="ONCE" style={{ width: 'auto', height: 30, padding: '0 8px' }}>
          <option value="ONCE">один раз</option>
          <option value="WEEKDAYS">по буднях</option>
          <option value="DAILY">щодня</option>
        </select>
        <button className="btn primary">Add</button>
      </form>

      <h2 className="block-title">Recurring <span className="faint" style={{ fontWeight: 400, fontSize: 15 }}>{recurring.length}</span></h2>
      {recurring.length === 0 && <p className="faint">Нічого. Наприклад: «Розіслати резюме», 30 хв, по буднях.</p>}
      {recurring.map((task) => <TaskRow key={task.id} task={task} />)}

      <h2 className="block-title">One-off <span className="faint" style={{ fontWeight: 400, fontSize: 15 }}>{open.length}</span></h2>
      {open.length === 0 && <p className="faint">Разових справ немає.</p>}
      {open.map((task) => <TaskRow key={task.id} task={task} />)}

      {done.length > 0 && (
        <>
          <h2 className="block-title">Done</h2>
          {done.map((task) => <TaskRow key={task.id} task={task} />)}
        </>
      )}
    </div>
  );
}
