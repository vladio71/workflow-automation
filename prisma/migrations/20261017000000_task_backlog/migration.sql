-- Jira-style task backlog: status, priority, notes.
-- Existing tasks are already "in progress", so they get TODO; new ones default to BACKLOG.
CREATE TYPE "TaskStatus" AS ENUM ('BACKLOG', 'TODO', 'IN_PROGRESS');

ALTER TABLE "Task" ADD COLUMN "status" "TaskStatus" NOT NULL DEFAULT 'TODO';
ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'BACKLOG';
ALTER TABLE "Task" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Task" ADD COLUMN "notes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Task" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
