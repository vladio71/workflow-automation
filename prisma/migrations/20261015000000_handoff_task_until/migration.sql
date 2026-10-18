-- Task with an end date: after until the planner stops suggesting it (interview prep until 19.10).
ALTER TABLE "Task" ADD COLUMN "until" DATE;

-- Evening handoff: "tomorrow I start with ...". day = the day this first step belongs to.
CREATE TABLE "Handoff" (
    "day" DATE NOT NULL,
    "firstStep" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Handoff_pkey" PRIMARY KEY ("day")
);
