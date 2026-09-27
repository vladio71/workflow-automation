-- Навчальний план з learn/plan.md
CREATE TYPE "PlanStepKind" AS ENUM ('READ', 'ATTEMPT', 'REFERENCE', 'SUMMARY', 'DEPTH', 'EXAM');

ALTER TABLE "Source" ADD COLUMN "planName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Source" ADD COLUMN "planDailyMinutes" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "PlanStep" (
    "id" SERIAL NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "group" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "kind" "PlanStepKind" NOT NULL DEFAULT 'READ',
    "link" TEXT NOT NULL DEFAULT '',
    "topicPath" TEXT NOT NULL DEFAULT '',
    "doneAt" TIMESTAMP(3),
    CONSTRAINT "PlanStep_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlanStep_sourceId_key_key" ON "PlanStep"("sourceId", "key");
CREATE INDEX "PlanStep_sourceId_position_idx" ON "PlanStep"("sourceId", "position");
ALTER TABLE "PlanStep" ADD CONSTRAINT "PlanStep_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
