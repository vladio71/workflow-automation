-- Card category deadline: until this date its cards repeat more often and go first in the queue.
ALTER TABLE "Topic" ADD COLUMN "deadline" DATE;
