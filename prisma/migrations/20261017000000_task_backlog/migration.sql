-- Беклог справ як у Jira: статус, пріоритет, нотатки.
-- Існуючі справи вже "в роботі", тому отримують TODO; нові за замовчуванням ідуть у BACKLOG.
CREATE TYPE "TaskStatus" AS ENUM ('BACKLOG', 'TODO', 'IN_PROGRESS');

ALTER TABLE "Task" ADD COLUMN "status" "TaskStatus" NOT NULL DEFAULT 'TODO';
ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'BACKLOG';
ALTER TABLE "Task" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Task" ADD COLUMN "notes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Task" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
