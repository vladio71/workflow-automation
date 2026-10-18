import { createTask, deleteTask, setTaskStatus, tickTaskForm, updateTaskForm } from '../actions';
import { db } from '@/lib/db';
import { MAX_TARGET, todayTickCounts } from '@/lib/task-sessions';
import { MAX_PRIORITY, MIN_PRIORITY, PRIORITY_LABEL, nextStatus, prevStatus } from '@/lib/task-backlog';
import TaskCard, { type TaskCardData } from '@/components/TaskCard';
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

function dateLabel(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function toCardData(task: Task, todayCount: number): TaskCardData {
  const done = task.doneAt !== null;
  return {
    id: task.id,
    title: task.title,
    notes: task.notes,
    minutes: task.minutes,
    priority: task.priority,
    repeatLabel: REPEAT_LABEL[task.repeat],
    target: task.target,
    todayCount,
    // until is stored as DATE (midnight UTC), so take the ISO day, not the local date
    until: task.until ? task.until.toISOString().slice(0, 10) : null,
    sinceLabel: done && task.doneAt ? `зроблено ${dateLabel(task.doneAt)}` : `з ${dateLabel(task.createdAt)}`,
    status: task.status,
    done,
    prev: prevStatus(task.status),
    next: nextStatus(task.status),
  };
}

function Card({ task, today }: { task: Task; today: number }) {
  return (
    <TaskCard
      task={toCardData(task, today)}
      actions={{
        save: updateTaskForm.bind(null, task.id),
        moveNext: setTaskStatus.bind(null, task.id, nextStatus(task.status)),
        movePrev: setTaskStatus.bind(null, task.id, prevStatus(task.status) ?? 'BACKLOG'),
        reopen: setTaskStatus.bind(null, task.id, 'TODO'),
        tick: tickTaskForm.bind(null, task.id),
        remove: deleteTask.bind(null, task.id),
      }}
      columnLabel={COLUMN_LABEL}
      priorityLabel={PRIORITY_LABEL}
      maxTarget={MAX_TARGET}
    />
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
  const card = (task: Task) => <Card key={task.id} task={task} today={counts.get(task.id) ?? 0} />;

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

      <div className="task-board">
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
