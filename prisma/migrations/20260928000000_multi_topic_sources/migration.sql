-- Кілька тем на одне репо: learn/<path>/topic.md
DROP INDEX "Topic_sourceId_key";
ALTER TABLE "Topic" ADD COLUMN "sourcePath" TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX "Topic_sourceId_sourcePath_key" ON "Topic"("sourceId", "sourcePath");

ALTER TABLE "Source" ADD COLUMN "lastSha" TEXT NOT NULL DEFAULT '';
