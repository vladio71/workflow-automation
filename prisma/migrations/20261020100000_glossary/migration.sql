-- Glossary terms per category, highlighted in card answers with a hover explanation.
CREATE TABLE "GlossaryTerm" (
    "id" SERIAL NOT NULL,
    "topicId" INTEGER,
    "term" TEXT NOT NULL,
    "termKey" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "definition" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GlossaryTerm_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GlossaryTerm_topicId_idx" ON "GlossaryTerm"("topicId");

ALTER TABLE "GlossaryTerm" ADD CONSTRAINT "GlossaryTerm_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
