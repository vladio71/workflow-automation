-- Card categories: a card's topic is its category. cardsUsedAt = when the category was last used,
-- the category picker is sorted by it.
ALTER TABLE "Topic" ADD COLUMN "cardsUsedAt" TIMESTAMP(3);

-- Daily on Today becomes an editable list: items live here, per-day ticks in DailyCheck.
CREATE TABLE "DailyItem" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "auto" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DailyItem_position_idx" ON "DailyItem"("position");

CREATE TABLE "DailyCheck" (
    "itemId" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    CONSTRAINT "DailyCheck_pkey" PRIMARY KEY ("itemId","day")
);
CREATE INDEX "DailyCheck_day_idx" ON "DailyCheck"("day");
ALTER TABLE "DailyCheck" ADD CONSTRAINT "DailyCheck_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "DailyItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- the three items that used to be hardcoded: their ticks stay in DailyLog (cards and recall tick themselves)
INSERT INTO "DailyItem" ("title", "position", "auto") VALUES
    ('Cards: everything due today (ticks itself when the queue is empty)', 0, 'cardsDone'),
    ('1 recall: blank page, then check', 1, 'recallDone'),
    ('1 question out loud in a minute', 2, 'outLoud');
