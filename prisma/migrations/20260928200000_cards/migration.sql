-- Cards inside the app instead of Anki
ALTER TYPE "ActivityKind" ADD VALUE 'CARDS';
CREATE TYPE "CardGrade" AS ENUM ('FORGOT', 'HARD', 'GOOD', 'PRACTICE');

ALTER TABLE "Question" DROP COLUMN "inAnki";
ALTER TABLE "Question" ADD COLUMN "cardDueAt" TIMESTAMP(3);
ALTER TABLE "Question" ADD COLUMN "cardInterval" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Question" ADD COLUMN "cardLapses" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Question" ADD COLUMN "cardReviewedAt" TIMESTAMP(3);

ALTER TABLE "DailyLog" RENAME COLUMN "ankiDone" TO "cardsDone";

CREATE TABLE "CardReview" (
    "id" SERIAL NOT NULL,
    "questionId" INTEGER NOT NULL,
    "grade" "CardGrade" NOT NULL,
    "wasNew" BOOLEAN NOT NULL DEFAULT false,
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CardReview_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CardReview_createdAt_idx" ON "CardReview"("createdAt");
ALTER TABLE "CardReview" ADD CONSTRAINT "CardReview_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
