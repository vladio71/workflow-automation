-- CreateEnum
CREATE TYPE "Track" AS ENUM ('GRAPHQL', 'SYSTEM_DESIGN', 'NODE', 'AI', 'PYTHON');
CREATE TYPE "Confidence" AS ENUM ('NOT_STARTED', 'RED', 'AMBER', 'GREEN');
CREATE TYPE "CycleStatus" AS ENUM ('PLANNED', 'ACTIVE', 'DONE');
CREATE TYPE "MessageRole" AS ENUM ('USER', 'MODEL');

-- CreateTable
CREATE TABLE "Topic" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "track" "Track" NOT NULL,
    "confidence" "Confidence" NOT NULL DEFAULT 'NOT_STARTED',
    "lastRecallAt" TIMESTAMP(3),
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "nextReviewAt" TIMESTAMP(3),
    "drill" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "cycleId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Question" (
    "id" SERIAL NOT NULL,
    "question" TEXT NOT NULL,
    "myAnswer" TEXT NOT NULL DEFAULT '',
    "reference" TEXT NOT NULL DEFAULT '',
    "inAnki" BOOLEAN NOT NULL DEFAULT false,
    "topicId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecallLog" (
    "id" SERIAL NOT NULL,
    "topicId" INTEGER NOT NULL,
    "questionId" INTEGER,
    "answer" TEXT NOT NULL,
    "feedback" TEXT NOT NULL DEFAULT '',
    "confidenceAfter" "Confidence" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecallLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Cycle" (
    "id" SERIAL NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT NOT NULL DEFAULT '',
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "status" "CycleStatus" NOT NULL DEFAULT 'PLANNED',
    "retro" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "Cycle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyLog" (
    "day" DATE NOT NULL,
    "ankiDone" BOOLEAN NOT NULL DEFAULT false,
    "recallDone" BOOLEAN NOT NULL DEFAULT false,
    "outLoud" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "DailyLog_pkey" PRIMARY KEY ("day")
);

CREATE TABLE "InboxItem" (
    "id" SERIAL NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InboxItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MockSession" (
    "id" SERIAL NOT NULL,
    "problem" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "MockSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MockMessage" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MockMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Topic_nextReviewAt_idx" ON "Topic"("nextReviewAt");
CREATE UNIQUE INDEX "Cycle_number_key" ON "Cycle"("number");

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "Cycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Question" ADD CONSTRAINT "Question_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecallLog" ADD CONSTRAINT "RecallLog_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecallLog" ADD CONSTRAINT "RecallLog_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MockMessage" ADD CONSTRAINT "MockMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MockSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
