CREATE TYPE "public"."budget_window" AS ENUM('global.day', 'owner.day', 'purpose.run');--> statement-breakpoint
CREATE TYPE "public"."meter_id" AS ENUM('solari.minutes', 'llm.input.tokens', 'llm.output.tokens', 'geocode.calls');--> statement-breakpoint
CREATE TABLE "budget_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meter" "meter_id" NOT NULL,
	"window" "budget_window" NOT NULL,
	"window_key" text NOT NULL,
	"amount" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "budget_counters_meter_window_key_idx" ON "budget_counters" USING btree ("meter","window","window_key");