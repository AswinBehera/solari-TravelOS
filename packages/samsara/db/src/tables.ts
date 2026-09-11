import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { timestamps } from "./columns.js"
import {
  budgetWindowEnum,
  harvestOutcomeEnum,
  meterIdEnum,
  personaHealthEnum,
  personaTierEnum,
  probeCadenceEnum,
  resolutionStateEnum,
  sessionOutcomeEnum,
  sessionPurposeEnum,
} from "./enums.js"

/**
 * Engine tables (plan section 3.1). No vertical vocabulary appears in this file.
 *
 * The rule that shapes everything here: an engine table never holds a foreign key
 * to a vertical's table. Where the engine points at a vertical's entity it stores an
 * opaque `(domain_id, entity_id)` pair with no constraint, and the pack's `EntityRepo`
 * resolves it. `owner_id` is the same idea applied to callers: plain text, no
 * reference, because the engine does not know what a user is.
 */

export const personas = pgTable(
  "personas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Free text: the city or region this identity reads as being in. */
    locality: text("locality").notNull(),
    /** Lowercase ISO 3166-1 alpha-2 — the form the proxy layer takes. */
    country: text("country").notNull(),
    locale: text("locale").notNull(),
    tier: personaTierEnum("tier").notNull(),
    solariProfileId: text("solari_profile_id"),
    /** Sticky IP key, so one identity keeps one address across sessions. */
    proxySession: text("proxy_session"),
    health: personaHealthEnum("health").notNull().default("healthy"),
    seedPlanId: uuid("seed_plan_id"),
    lastAliveAt: timestamp("last_alive_at", { withTimezone: true }),
    statSessions: integer("stat_sessions").notNull().default(0),
    statMinutes: doublePrecision("stat_minutes").notNull().default(0),
    statBlocks: integer("stat_blocks").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("personas_country_health_idx").on(t.country, t.health)],
)

export const seedPlans = pgTable("seed_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  locality: text("locality").notNull(),
  /** Versioned: comparing identity drift is meaningless if the recipe moved underneath it. */
  version: integer("version").notNull().default(1),
  steps: jsonb("steps").notNull(),
  ...timestamps,
})

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purpose: sessionPurposeEnum("purpose").notNull(),
    /** Opaque. No foreign key: the engine does not know what a user is. */
    ownerId: text("owner_id"),
    domainId: text("domain_id"),
    personaId: uuid("persona_id").references(() => personas.id, { onDelete: "set null" }),
    country: text("country").notNull(),
    /** What the browser claimed to be, as distinct from where it egressed. */
    locale: text("locale"),
    timezoneId: text("timezone_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    minutes: doublePrecision("minutes").notNull().default(0),
    outcome: sessionOutcomeEnum("outcome").notNull().default("running"),
    recordingRef: text("recording_ref"),
    ...timestamps,
  },
  (t) => [
    // The budget guard reads this shape every time it decides whether to launch.
    index("sessions_owner_started_idx").on(t.ownerId, t.startedAt),
    index("sessions_purpose_started_idx").on(t.purpose, t.startedAt),
  ],
)

export const harvestRuns = pgTable(
  "harvest_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    domainId: text("domain_id").notNull(),
    personaId: uuid("persona_id")
      .notNull()
      .references(() => personas.id, { onDelete: "restrict" }),
    sourceId: text("source_id").notNull(),
    query: text("query").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    outcome: harvestOutcomeEnum("outcome").notNull().default("running"),
    itemCount: integer("item_count").notNull().default(0),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (t) => [index("harvest_runs_domain_source_idx").on(t.domainId, t.sourceId, t.startedAt)],
)

export const rawItems = pgTable(
  "raw_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    harvestRunId: uuid("harvest_run_id")
      .notNull()
      .references(() => harvestRuns.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    text: text("text").notNull(),
    /** What the source or a cheap detector claimed. Not authoritative. */
    languageGuess: text("language_guess"),
    mediaRefs: text("media_refs").array().notNull().default([]),
    engagementViews: integer("engagement_views"),
    engagementLikes: integer("engagement_likes"),
    engagementComments: integer("engagement_comments"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    /** Untouched response body in object storage, for when a parser turns out wrong. */
    rawRef: text("raw_ref").notNull(),
    ...timestamps,
  },
  (t) => [
    index("raw_items_run_idx").on(t.harvestRunId),
    // Re-running extraction scans by source and time. It must never scan by URL.
    index("raw_items_source_captured_idx").on(t.sourceId, t.capturedAt),
  ],
)

export const mentions = pgTable(
  "mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rawItemId: uuid("raw_item_id")
      .notNull()
      .references(() => rawItems.id, { onDelete: "cascade" }),
    domainId: text("domain_id").notNull(),
    /** Bumped when a pack's prompts or weights change, so old rows stay readable. */
    packVersion: text("pack_version").notNull(),
    /** Validated against the pack's own mentionSchema at the boundary, not here. */
    payload: jsonb("payload").notNull(),
    /** Opaque pointer into the pack's table. Null until resolved. No foreign key, by design. */
    entityId: uuid("entity_id"),
    resolution: resolutionStateEnum("resolution").notNull().default("pending"),
    confidence: doublePrecision("confidence").notNull(),
    ...timestamps,
  },
  (t) => [index("mentions_domain_resolution_idx").on(t.domainId, t.resolution)],
)

export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    domainId: text("domain_id").notNull(),
    /** Opaque by design — no foreign key to a vertical's table. */
    entityId: uuid("entity_id").notNull(),
    rawItemId: uuid("raw_item_id")
      .notNull()
      .references(() => rawItems.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    personaId: uuid("persona_id")
      .notNull()
      .references(() => personas.id, { onDelete: "restrict" }),
    language: text("language"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    /** Pack-shaped. The engine carries it without reading it. */
    extract: jsonb("extract").notNull(),
    rawRef: text("raw_ref").notNull(),
    engagementViews: integer("engagement_views"),
    engagementLikes: integer("engagement_likes"),
    engagementComments: integer("engagement_comments"),
    ...timestamps,
  },
  (t) => [
    // Every score explanation resolves through this index. It is the hot one.
    index("evidence_domain_entity_idx").on(t.domainId, t.entityId),
  ],
)

export const probeTargets = pgTable(
  "probe_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id"),
    sourceId: text("source_id").notNull(),
    url: text("url").notNull(),
    /** Shape declared by the source adapter. The engine does not read it. */
    parsed: jsonb("parsed").notNull(),
    watch: boolean("watch").notNull().default(false),
    cadence: probeCadenceEnum("cadence"),
    ...timestamps,
  },
  (t) => [index("probe_targets_watch_cadence_idx").on(t.watch, t.cadence)],
)

export const observations = pgTable(
  "observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetId: uuid("target_id")
      .notNull()
      .references(() => probeTargets.id, { onDelete: "cascade" }),
    country: text("country").notNull(),
    personaId: uuid("persona_id").references(() => personas.id, { onDelete: "set null" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    /**
     * Generic on purpose: a fare is one shape, a ranked result list another, a
     * rendered ad slot a third. Adding a fourth must not require a migration.
     */
    payload: jsonb("payload").notNull(),
    screenshotRef: text("screenshot_ref").notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "restrict" }),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("observations_target_captured_idx").on(t.targetId, t.capturedAt)],
)

/**
 * The budget guard's counters (plan section 2.4). One row per
 * `(meter, window, window_key)`; the guard reads before it spends and adds after.
 *
 * These live in Postgres rather than in a cache because a scheduled runner exits
 * between drains (ADR-0014), and a counter that resets when the process does would
 * make the ceiling in section 8 decorative. Ceilings themselves are not stored:
 * they are constants in `@samsara/kernel`, so changing one is a reviewed diff
 * rather than an UPDATE nobody sees.
 */
export const budgetCounters = pgTable(
  "budget_counters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meter: meterIdEnum("meter").notNull(),
    window: budgetWindowEnum("window").notNull(),
    /** The value the window is sliced by: a date, `<ownerId>:<date>`, or `<purpose>:<runId>`. */
    windowKey: text("window_key").notNull(),
    amount: doublePrecision("amount").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    // Load-bearing, not an optimisation: the guard upserts against this constraint,
    // so two concurrent runners increment one row instead of racing to create two.
    uniqueIndex("budget_counters_meter_window_key_idx").on(t.meter, t.window, t.windowKey),
  ],
)
