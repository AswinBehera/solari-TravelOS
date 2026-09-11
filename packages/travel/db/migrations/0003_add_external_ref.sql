ALTER TABLE "places" ADD COLUMN "external_ref" jsonb;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "resolved_tier" integer;--> statement-breakpoint
CREATE INDEX "places_external_ref_idx" ON "places" USING btree ("external_ref");