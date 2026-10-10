-- Inbox стає парковкою: ті самі записи, плюс "взято на експеримент" і "зроблено"
ALTER TABLE "InboxItem" RENAME TO "ParkingItem";
ALTER TABLE "ParkingItem" RENAME CONSTRAINT "InboxItem_pkey" TO "ParkingItem_pkey";
ALTER SEQUENCE "InboxItem_id_seq" RENAME TO "ParkingItem_id_seq";
ALTER TABLE "ParkingItem" ADD COLUMN "pickedAt" TIMESTAMP(3);
ALTER TABLE "ParkingItem" ADD COLUMN "doneAt" TIMESTAMP(3);

-- Прогрес по клітинках карти
CREATE TABLE "CellProgress" (
    "cellId" TEXT NOT NULL,
    "derived" TEXT NOT NULL DEFAULT '',
    "derivedAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "summary" TEXT NOT NULL DEFAULT '',
    "summarizedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CellProgress_pkey" PRIMARY KEY ("cellId")
);

-- Спроби дрилів
CREATE TABLE "DrillAttempt" (
    "id" SERIAL NOT NULL,
    "drillId" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "checked" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DrillAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DrillAttempt_drillId_createdAt_idx" ON "DrillAttempt"("drillId", "createdAt");

-- Відповіді вголос
CREATE TABLE "SpokenAnswer" (
    "id" SERIAL NOT NULL,
    "day" DATE NOT NULL,
    "subject" TEXT NOT NULL,
    "stuck" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpokenAnswer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SpokenAnswer_day_idx" ON "SpokenAnswer"("day");
