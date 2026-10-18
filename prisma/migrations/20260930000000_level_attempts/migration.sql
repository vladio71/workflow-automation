-- Levels: attempts at a live-code exercise (code, test verdict, output)
CREATE TABLE "LevelAttempt" (
    "id" SERIAL NOT NULL,
    "levelKey" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "gaveUp" BOOLEAN NOT NULL DEFAULT false,
    "output" TEXT NOT NULL DEFAULT '',
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LevelAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LevelAttempt_levelKey_createdAt_idx" ON "LevelAttempt"("levelKey", "createdAt");
