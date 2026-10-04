-- Картки як у Quizlet: додати, змінити, видалити прямо в All cards.
-- Картку з репо, яку змінили в апці, Sync більше не перезаписує; видалену не створює знову.
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
