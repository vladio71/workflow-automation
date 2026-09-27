-- CreateTable
CREATE TABLE "DailyPlan" (
    "day" DATE NOT NULL,
    "items" JSONB NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "review" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DailyPlan_pkey" PRIMARY KEY ("day")
);
