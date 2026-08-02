-- Planning-stage staffing target for a show: how many sales reps it needs.
-- Nullable, so it is safe to add to the existing (possibly non-empty) table.
ALTER TABLE "ShowEvent" ADD COLUMN "repsNeeded" INTEGER;
