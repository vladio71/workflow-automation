-- Images for cards (diagrams, screenshots), referenced from answers as /api/images/<id>.
CREATE TABLE "CardImage" (
    "id" SERIAL NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "alt" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CardImage_pkey" PRIMARY KEY ("id")
);
