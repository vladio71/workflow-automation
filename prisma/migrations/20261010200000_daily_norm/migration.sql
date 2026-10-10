-- Норма дня замість AI-плану: план дня і щоденний чекліст більше не потрібні
DROP TABLE IF EXISTS "DailyCheck";
DROP TABLE IF EXISTS "DailyItem";
DROP TABLE IF EXISTS "DailyPlan";

-- Цикл = розділ матеріалу
ALTER TABLE "Cycle" ADD COLUMN "section" TEXT NOT NULL DEFAULT '';

-- Повтори закритих клітинок
CREATE TABLE "CellRedo" (
    "id" SERIAL NOT NULL,
    "cellId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CellRedo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CellRedo_cellId_createdAt_idx" ON "CellRedo"("cellId", "createdAt");
