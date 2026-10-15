-- Справа з кінцевою датою: після until планер її більше не пропонує (підготовка до інтерв'ю до 19.10).
ALTER TABLE "Task" ADD COLUMN "until" DATE;

-- Вечірня передача дня: "завтра починаю з ...". day = день, на який цей перший крок.
CREATE TABLE "Handoff" (
    "day" DATE NOT NULL,
    "firstStep" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Handoff_pkey" PRIMARY KEY ("day")
);
