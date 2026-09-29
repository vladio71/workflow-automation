-- Telegram-бот: доставка карток, одна на картку за день
CREATE TYPE "TelegramDeliveryStatus" AS ENUM ('SENT', 'REVEALED', 'GRADED', 'STALE');

CREATE TABLE "TelegramDelivery" (
    "id" SERIAL NOT NULL,
    "questionId" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "chatId" TEXT NOT NULL,
    "messageId" INTEGER,
    "status" "TelegramDeliveryStatus" NOT NULL DEFAULT 'SENT',
    "grade" "CardGrade",
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revealedAt" TIMESTAMP(3),
    "gradedAt" TIMESTAMP(3),
    CONSTRAINT "TelegramDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TelegramDelivery_questionId_day_key" ON "TelegramDelivery"("questionId", "day");
CREATE INDEX "TelegramDelivery_day_idx" ON "TelegramDelivery"("day");
ALTER TABLE "TelegramDelivery" ADD CONSTRAINT "TelegramDelivery_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
