-- AlterEnum
ALTER TYPE "Track" ADD VALUE 'OTHER';

-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('STUDY', 'DRILL', 'RECALL', 'QUESTIONS', 'READING', 'MOCK', 'OTHER');

-- AlterTable: cycles no longer have fixed dates
ALTER TABLE "Cycle" DROP COLUMN "startsOn",
DROP COLUMN "endsOn",
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" SERIAL NOT NULL,
    "day" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "kind" "ActivityKind" NOT NULL,
    "track" "Track",
    "topicId" INTEGER,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityLog_day_idx" ON "ActivityLog"("day");

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
