-- CreateEnum
CREATE TYPE "CardKind" AS ENUM ('CONCEPT', 'TASK');

-- CreateTable
CREATE TABLE "Source" (
    "id" SERIAL NOT NULL,
    "repo" TEXT NOT NULL,
    "branch" TEXT NOT NULL DEFAULT 'main',
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT NOT NULL DEFAULT '',
    "lastSummary" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Source_repo_key" ON "Source"("repo");

-- AlterTable
ALTER TABLE "Topic" ADD COLUMN "sourceId" INTEGER;
CREATE UNIQUE INDEX "Topic_sourceId_key" ON "Topic"("sourceId");
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Question" ADD COLUMN "kind" "CardKind" NOT NULL DEFAULT 'CONCEPT',
ADD COLUMN "ref" TEXT NOT NULL DEFAULT '',
ADD COLUMN "check" TEXT NOT NULL DEFAULT '',
ADD COLUMN "sourceKey" TEXT,
ADD COLUMN "sourceId" INTEGER;
CREATE UNIQUE INDEX "Question_sourceKey_key" ON "Question"("sourceKey");
ALTER TABLE "Question" ADD CONSTRAINT "Question_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;
