-- Quizlet-style cards: add, edit and delete directly in All cards.
-- A repo card edited in the app is no longer overwritten by Sync; a deleted one is not recreated.
ALTER TABLE "Question" ADD COLUMN "editedInApp" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "DeletedCard" (
    "id" SERIAL NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeletedCard_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeletedCard_sourceId_sourceKey_key" ON "DeletedCard"("sourceId", "sourceKey");
ALTER TABLE "DeletedCard" ADD CONSTRAINT "DeletedCard_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
