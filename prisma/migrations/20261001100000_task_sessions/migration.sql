-- Session tasks: a daily target and a log of steps that build the day's tower.
ALTER TABLE "Task" ADD COLUMN "target" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "TaskTick" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskTick_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskTick_taskId_day_idx" ON "TaskTick"("taskId", "day");

ALTER TABLE "TaskTick" ADD CONSTRAINT "TaskTick_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
