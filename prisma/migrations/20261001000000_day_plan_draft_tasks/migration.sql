-- План дня: чернетка до старту, фокус і побажання. Справи поза навчанням.
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
ADD COLUMN "focusSourceId" INTEGER,
ADD COLUMN "wish" TEXT NOT NULL DEFAULT '',
ADD COLUMN "budget" INTEGER NOT NULL DEFAULT 0;

-- плани, складені до цієї зміни, вже були робочими, а не чернетками
UPDATE "DailyPlan" SET "startedAt" = "createdAt";
