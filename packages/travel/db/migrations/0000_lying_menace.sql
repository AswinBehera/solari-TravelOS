CREATE TYPE "public"."harvest_outcome" AS ENUM('running', 'ok', 'blocked', 'empty', 'error');--> statement-breakpoint
CREATE TYPE "public"."persona_health" AS ENUM('healthy', 'degraded', 'banned', 'retired');--> statement-breakpoint
CREATE TYPE "public"."persona_tier" AS ENUM('anon', 'seeded');--> statement-breakpoint
CREATE TYPE "public"."probe_cadence" AS ENUM('hourly', 'daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."resolution_state" AS ENUM('pending', 'resolved', 'unresolvable');--> statement-breakpoint
CREATE TYPE "public"."session_outcome" AS ENUM('running', 'ok', 'blocked', 'timeout', 'error', 'orphaned');--> statement-breakpoint
CREATE TYPE "public"."session_purpose" AS ENUM('persona.seed', 'persona.keepalive', 'harvest', 'probe', 'agent');--> statement-breakpoint
CREATE TYPE "public"."place_category" AS ENUM('food', 'drink', 'market', 'temple', 'nature', 'nightlife', 'shop', 'other');--> statement-breakpoint
CREATE TYPE "public"."postcard_kind" AS ENUM('place', 'price', 'note', 'photo', 'link', 'checklist');--> statement-breakpoint
CREATE TYPE "public"."postcard_state" AS ENUM('fresh', 'stale', 'pinned');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('dreaming', 'planning', 'travelling', 'done');--> statement-breakpoint
CREATE TYPE "public"."user_plan" AS ENUM('free', 'pro');--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"raw_item_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"source_url" text NOT NULL,
	"persona_id" uuid NOT NULL,
	"language" text,
	"captured_at" timestamp with time zone NOT NULL,
	"extract" jsonb NOT NULL,
	"raw_ref" text NOT NULL,
	"engagement_views" integer,
	"engagement_likes" integer,
	"engagement_comments" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "harvest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" text NOT NULL,
	"persona_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"query" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"outcome" "harvest_outcome" DEFAULT 'running' NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"session_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw_item_id" uuid NOT NULL,
	"domain_id" text NOT NULL,
	"pack_version" text NOT NULL,
	"payload" jsonb NOT NULL,
	"entity_id" uuid,
	"resolution" "resolution_state" DEFAULT 'pending' NOT NULL,
	"confidence" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"country" text NOT NULL,
	"persona_id" uuid,
	"captured_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"screenshot_ref" text NOT NULL,
	"session_id" uuid NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"locality" text NOT NULL,
	"country" text NOT NULL,
	"locale" text NOT NULL,
	"tier" "persona_tier" NOT NULL,
	"solari_profile_id" text,
	"proxy_session" text,
	"health" "persona_health" DEFAULT 'healthy' NOT NULL,
	"seed_plan_id" uuid,
	"last_alive_at" timestamp with time zone,
	"stat_sessions" integer DEFAULT 0 NOT NULL,
	"stat_minutes" double precision DEFAULT 0 NOT NULL,
	"stat_blocks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "probe_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text,
	"source_id" text NOT NULL,
	"url" text NOT NULL,
	"parsed" jsonb NOT NULL,
	"watch" boolean DEFAULT false NOT NULL,
	"cadence" "probe_cadence",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"harvest_run_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"text" text NOT NULL,
	"language_guess" text,
	"media_refs" text[] DEFAULT '{}' NOT NULL,
	"engagement_views" integer,
	"engagement_likes" integer,
	"engagement_comments" integer,
	"captured_at" timestamp with time zone NOT NULL,
	"raw_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seed_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"locality" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"steps" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" "session_purpose" NOT NULL,
	"owner_id" text,
	"domain_id" text,
	"persona_id" uuid,
	"country" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"minutes" double precision DEFAULT 0 NOT NULL,
	"outcome" "session_outcome" DEFAULT 'running' NOT NULL,
	"recording_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"content" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_name" text NOT NULL,
	"local_name" text,
	"city" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"google_place_id" text,
	"category" "place_category" DEFAULT 'other' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "postcards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"kind" "postcard_kind" NOT NULL,
	"place_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"time_start" timestamp with time zone,
	"time_end" timestamp with time zone,
	"source_refs" uuid[] DEFAULT '{}' NOT NULL,
	"state" "postcard_state" DEFAULT 'fresh' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"destination_city" text NOT NULL,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"status" "trip_status" DEFAULT 'dreaming' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"plan" "user_plan" DEFAULT 'free' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"budget_solari_minutes_per_day" integer,
	"budget_geocode_calls_per_day" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_raw_item_id_raw_items_id_fk" FOREIGN KEY ("raw_item_id") REFERENCES "public"."raw_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harvest_runs" ADD CONSTRAINT "harvest_runs_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harvest_runs" ADD CONSTRAINT "harvest_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_raw_item_id_raw_items_id_fk" FOREIGN KEY ("raw_item_id") REFERENCES "public"."raw_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_target_id_probe_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."probe_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_items" ADD CONSTRAINT "raw_items_harvest_run_id_harvest_runs_id_fk" FOREIGN KEY ("harvest_run_id") REFERENCES "public"."harvest_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postcards" ADD CONSTRAINT "postcards_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postcards" ADD CONSTRAINT "postcards_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_domain_entity_idx" ON "evidence" USING btree ("domain_id","entity_id");--> statement-breakpoint
CREATE INDEX "harvest_runs_domain_source_idx" ON "harvest_runs" USING btree ("domain_id","source_id","started_at");--> statement-breakpoint
CREATE INDEX "mentions_domain_resolution_idx" ON "mentions" USING btree ("domain_id","resolution");--> statement-breakpoint
CREATE INDEX "observations_target_captured_idx" ON "observations" USING btree ("target_id","captured_at");--> statement-breakpoint
CREATE INDEX "personas_country_health_idx" ON "personas" USING btree ("country","health");--> statement-breakpoint
CREATE INDEX "probe_targets_watch_cadence_idx" ON "probe_targets" USING btree ("watch","cadence");--> statement-breakpoint
CREATE INDEX "raw_items_run_idx" ON "raw_items" USING btree ("harvest_run_id");--> statement-breakpoint
CREATE INDEX "raw_items_source_captured_idx" ON "raw_items" USING btree ("source_id","captured_at");--> statement-breakpoint
CREATE INDEX "sessions_owner_started_idx" ON "sessions" USING btree ("owner_id","started_at");--> statement-breakpoint
CREATE INDEX "sessions_purpose_started_idx" ON "sessions" USING btree ("purpose","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_trip_unique" ON "documents" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "places_google_id_idx" ON "places" USING btree ("google_place_id");--> statement-breakpoint
CREATE INDEX "places_city_category_idx" ON "places" USING btree ("city","category");--> statement-breakpoint
CREATE INDEX "postcards_trip_state_idx" ON "postcards" USING btree ("trip_id","state");--> statement-breakpoint
CREATE INDEX "trips_user_status_idx" ON "trips" USING btree ("user_id","status");