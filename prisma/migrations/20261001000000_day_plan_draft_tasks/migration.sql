-- Day plan: a draft until started, plus focus and wish. Tasks outside of study.
CREATE TYPE "TaskRepeat" AS ENUM ('ONCE', 'DAILY', 'WEEKDAYS');

CREATE TABLE "Task" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 30,
    "repeat" "TaskRepeat" NOT NULL DEFAULT 'ONCE',
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DailyPlan" ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "focus" TEXT NOT NULL DEFAULT '',
ADD COLUMN "wish" TEXT NOT NULL DEFAULT '',
ADD COLUMN "budget" INTEGER NOT NULL DEFAULT 0;

-- plans created before this change were already live, not drafts
UPDATE "DailyPlan" SET "startedAt" = "createdAt";
