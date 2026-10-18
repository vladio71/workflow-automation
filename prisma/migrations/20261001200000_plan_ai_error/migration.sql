-- Why Gemini failed to build the day plan: shown in red under the card and survives a reload.
ALTER TABLE "DailyPlan" ADD COLUMN "aiError" TEXT NOT NULL DEFAULT '';
