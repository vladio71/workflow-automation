-- Loot chest: pool of rest cards and the pulls from the chest
CREATE TYPE "LootRarity" AS ENUM ('COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY');

CREATE TABLE "RestCard" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "rarity" "LootRarity" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT NOT NULL DEFAULT '',
    "minutes" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "afterBoss" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "pulledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RestCard_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RestCard_dedupeKey_key" ON "RestCard"("dedupeKey");
CREATE INDEX "RestCard_rarity_pulledAt_expiresAt_idx" ON "RestCard"("rarity", "pulledAt", "expiresAt");

CREATE TABLE "RestPull" (
    "id" SERIAL NOT NULL,
    "day" DATE NOT NULL,
    "rarity" "LootRarity" NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT NOT NULL DEFAULT '',
    "minutes" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "guarantee" TEXT NOT NULL DEFAULT '',
    "restCardId" INTEGER,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "RestPull_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RestPull_day_idx" ON "RestPull"("day");
ALTER TABLE "RestPull" ADD CONSTRAINT "RestPull_restCardId_fkey" FOREIGN KEY ("restCardId") REFERENCES "RestCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
