-- Категорії карток: тема картки = її категорія. cardsUsedAt = коли категорією востаннє користувались,
-- за ним сортується список у виборі категорії.
ALTER TABLE "Topic" ADD COLUMN "cardsUsedAt" TIMESTAMP(3);

-- Daily на Today стає списком, який можна правити: пункти тут, галочки по днях у DailyCheck.
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

-- три пункти, які були зашиті в код: їхні галочки лишаються в DailyLog (cards і recall ставляться самі)
INSERT INTO "DailyItem" ("title", "position", "auto") VALUES
    ('Cards: everything due today (ticks itself when the queue is empty)', 0, 'cardsDone'),
    ('1 recall: blank page, then check', 1, 'recallDone'),
    ('1 question out loud in a minute', 2, 'outLoud');
