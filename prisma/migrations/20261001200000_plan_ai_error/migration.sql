-- Чому Gemini не склав план дня: показується червоним під картою і не зникає після перезавантаження.
ALTER TABLE "DailyPlan" ADD COLUMN "aiError" TEXT NOT NULL DEFAULT '';
