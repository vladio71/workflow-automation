import { createTask, deleteTask, setTaskPriority, setTaskStatus, setTaskTarget, tickTaskForm } from '../actions';
import { db } from '@/lib/db';
import { MAX_TARGET, todayTickCounts } from '@/lib/task-sessions';
import { MAX_PRIORITY, MIN_PRIORITY, PRIORITY_LABEL, nextStatus, prevStatus } from '@/lib/task-backlog';
import type { Task, TaskRepeat, TaskStatus } from '@/generated/prisma/client';

const REPEAT_LABEL: Record<TaskRepeat, string> = {
  ONCE: 'один раз',
  DAILY: 'щодня',
  WEEKDAYS: 'по буднях',
};

const COLUMN_LABEL: Record<TaskStatus, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
};

const COLUMNS: readonly TaskStatus[] = ['BACKLOG', 'TODO', 'IN_PROGRESS'];
const PRIORITY_COLOR: Record<number, string> = { 1: 'red', 2: 'orange', 3: 'gray', 4: 'gray' };

const CARD_STYLE = {
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '8px 10px',
  marginBottom: 8,
  background: 'var(--bg)',
} as const;

function dateLabel(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** until лежить як DATE (опівніч UTC), тому показуємо його за UTC, інакше в Києві це "попередній день" */
function untilLabel(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function PriorityTag({ task }: { task: Task }) {
  return (
    <form action={setTaskPriority.bind(null, task.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }} title="Пріоритет: 1 high … 4 low">
      <select className={`tag ${PRIORITY_COLOR[task.priority] ?? 'gray'}`} name="priority" defaultValue={task.priority} style={{ border: 0, cursor: 'pointer' }}>
        {Array.from({ length: MAX_PRIORITY - MIN_PRIORITY + 1 }, (_, index) => MIN_PRIORITY + index).map((value) => (
          <option key={value} value={value}>P{value} {PRIORITY_LABEL[value]}</option>
        ))}
      </select>
      <button className="btn sm ghost" title="Зберегти пріоритет">✓</button>
    </form>
  );
}

function TaskCard({ task, today }: { task: Task; today: number }) {
  const once = task.repeat === 'ONCE';
  const done = task.doneAt !== null;
  const session = task.target > 0;
  const next = nextStatus(task.status);
  const prev = prevStatus(task.status);
  return (
    <div className="row-hover" style={CARD_STYLE} data-task={task.id} data-status={done ? 'DONE' : task.status}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ textDecoration: done ? 'line-through' : 'none', color: done ? 'var(--faint)' : undefined, overflowWrap: 'anywhere' }}>
            {session && '🏰 '}{task.title}
          </div>
          <div className="faint" style={{ fontSize: 12 }}>
            {task.minutes} min · {REPEAT_LABEL[task.repeat]}
            {session && ` · сесія: ${task.target} за день`}
            {task.until && ` · до ${untilLabel(task.until)}`}
            {once && (done && task.doneAt ? ` · зроблено ${dateLabel(task.doneAt)}` : ` · з ${dateLabel(task.createdAt)}`)}
          </div>
          {task.notes && <div className="faint" style={{ fontSize: 12, marginTop: 4, whiteSpace: 'pre-wrap' }}>{task.notes}</div>}
        </div>
        {!done && <PriorityTag task={task} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
        {session && !done && (
          <>
            <span className={`tag ${today >= task.target ? 'green' : 'gray'}`}>{today}/{task.target} сьогодні</span>
            <form action={tickTaskForm.bind(null, task.id)}><button className="btn sm" title="Відправив ще одне">+1</button></form>
          </>
        )}
        {done ? (
          <form action={setTaskStatus.bind(null, task.id, 'TODO')}><button className="btn sm ghost" title="Повернути в To do">↩ reopen</button></form>
        ) : (
          <>
            {prev && (
              <form action={setTaskStatus.bind(null, task.id, prev)}><button className="btn sm ghost" title={`← ${COLUMN_LABEL[prev]}`}>←</button></form>
            )}
            <form action={setTaskStatus.bind(null, task.id, next)}>
              <button className={`btn sm ${next === 'DONE' ? 'primary' : ''}`} title={next === 'DONE' ? 'Зроблено' : `→ ${COLUMN_LABEL[next]}`}>
                {next === 'DONE' ? '✓ done' : '→'}
              </button>
            </form>
          </>
        )}
        <span style={{ flex: 1 }} />
        <form action={setTaskTarget.bind(null, task.id)} style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Ціль на день: 0 = звичайна справа з галочкою">
          <input className="input" name="target" type="number" min={0} max={MAX_TARGET} defaultValue={task.target} aria-label="Ціль на день" style={{ width: 54, height: 24 }} />
          <button className="btn sm ghost" title="Зберегти ціль">✓</button>
        </form>
        <form action={deleteTask.bind(null, task.id)}><button className="btn sm ghost" title="Видалити">✕</button></form>
      </div>
    </div>
  );
}

export default async function TasksPage() {
  const tasks = await db.task.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
  const counts = await todayTickCounts(tasks.filter((task) => task.target > 0).map((task) => task.id));
  const open = tasks.filter((task) => task.doneAt === null);
  const byColumn = (status: TaskStatus) => open.filter((task) => task.status === status);
  const done = tasks
    .filter((task) => task.doneAt !== null)
    .sort((a, b) => (b.doneAt?.getTime() ?? 0) - (a.doneAt?.getTime() ?? 0))
    .slice(0, 15);
  const card = (task: Task) => <TaskCard key={task.id} task={task} today={counts.get(task.id) ?? 0} />;

  return (
    <div className="page">
      <div className="page-icon">📌</div>
      <h1 className="page-title">Tasks</h1>
      <p className="page-sub">
        Справи поза навчанням, борд як у Jira. Backlog лежить і в план дня не лізе; To do та In progress план бере.
        Повторювані (щодня, по буднях) одразу в роботі. Справа з ціллю на день (🏰, наприклад 10 резюме) стає сесією:
        +1 за кожен раз, з них росте башта на Today. Ззовні класти в беклог: <code>POST /api/tasks</code> з токеном.
      </p>

      <form action={createTask} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input className="input" name="title" required maxLength={200} placeholder="Налаштувати Jomo, залити апку і бота на сервер…" style={{ flex: 1, minWidth: 240, height: 30 }} />
        <select className="input" name="priority" defaultValue={3} title="Пріоритет" style={{ width: 'auto', height: 30, padding: '0 8px' }}>
          {Array.from({ length: MAX_PRIORITY - MIN_PRIORITY + 1 }, (_, index) => MIN_PRIORITY + index).map((value) => (
            <option key={value} value={value}>P{value} {PRIORITY_LABEL[value]}</option>
          ))}
        </select>
        <input className="input" name="minutes" type="number" min={5} max={480} step={5} defaultValue={30} style={{ width: 76, height: 30 }} />
        <span className="faint" style={{ fontSize: 13 }}>min</span>
        <select className="input" name="repeat" defaultValue="ONCE" style={{ width: 'auto', height: 30, padding: '0 8px' }}>
          <option value="ONCE">один раз</option>
          <option value="WEEKDAYS">по буднях</option>
          <option value="DAILY">щодня</option>
        </select>
        <input className="input" name="target" type="number" min={0} max={MAX_TARGET} placeholder="ціль" title="Ціль на день (необов'язково): 10 = сесія з лічильником і баштою" style={{ width: 70, height: 30 }} />
        <input className="input" name="until" type="date" title="До якого дня включно справа в плані (необов'язково): після цієї дати зникає сама" style={{ width: 'auto', height: 30 }} />
        <button className="btn primary">Add</button>
      </form>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginTop: 16, alignItems: 'start' }}>
        {COLUMNS.map((status) => {
          const column = byColumn(status);
          return (
            <section key={status} data-column={status}>
              <h2 className="block-title" style={{ marginTop: 0 }}>
                {COLUMN_LABEL[status]} <span className="faint" style={{ fontWeight: 400, fontSize: 15 }}>{column.length}</span>
              </h2>
              {column.length === 0 && <p className="faint" style={{ fontSize: 13 }}>Порожньо.</p>}
              {column.map(card)}
            </section>
          );
        })}
      </div>

      {done.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary className="block-title" style={{ cursor: 'pointer' }}>Done <span className="faint" style={{ fontWeight: 400, fontSize: 15 }}>{done.length}</span></summary>
          <div style={{ maxWidth: 520 }}>{done.map(card)}</div>
        </details>
      )}
    </div>
  );
}
