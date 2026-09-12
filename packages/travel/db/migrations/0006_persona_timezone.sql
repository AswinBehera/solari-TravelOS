-- A persona's clock, stored rather than derived from its country or its locale.
--
-- Written by hand over drizzle-kit's `ADD COLUMN "timezone_id" text NOT NULL`,
-- which is correct against an empty table and fails against any other. The
-- default backfills existing rows with what they actually were — nothing ever set
-- a timezone, so those sessions ran on UTC — and is then dropped, so that every
-- persona created from here on has to say what time it is where it lives.
ALTER TABLE "personas" ADD COLUMN "timezone_id" text NOT NULL DEFAULT 'UTC';--> statement-breakpoint
ALTER TABLE "personas" ALTER COLUMN "timezone_id" DROP DEFAULT;
