import {
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
import {
  placeCategoryEnum,
  postcardKindEnum,
  postcardStateEnum,
  tripStatusEnum,
  userPlanEnum,
} from "./enums.js"

/**
 * Travel tables (plan section 3.2). Everything here may know it is about travel.
 *
 * Travel may point at engine tables freely — the restriction runs one way only.
 * `postcards.source_refs` holds Evidence ids, and `places` is reached from the engine
 * solely through the opaque `(domain_id, entity_id)` pair, never by a foreign key.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}

export const users = pgTable("users", {
  /**
   * The Supabase Auth user id — the JWT's `sub` (ADR-0013). Not generated here: one
   * identity, one lifetime, no join table reconciling two id spaces. Deliberately no
   * foreign key to `auth.users`, so local development needs no auth schema.
   */
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  plan: userPlanEnum("plan").notNull().default("free"),
  locale: text("locale").notNull().default("en"),
  /** Null means "use the kernel's global ceiling". The guard reads these; it does not negotiate. */
  budgetSolariMinutesPerDay: integer("budget_solari_minutes_per_day"),
  budgetGeocodeCallsPerDay: integer("budget_geocode_calls_per_day"),
  ...timestamps,
})

export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Canonical, not as typed. "Bangkok", never "bkk". */
    destinationCity: text("destination_city").notNull(),
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    status: tripStatusEnum("status").notNull().default("dreaming"),
    ...timestamps,
  },
  (t) => [index("trips_user_status_idx").on(t.userId, t.status)],
)

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    /** Tiptap/ProseMirror JSON. */
    content: jsonb("content").notNull(),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  // One document per trip in v1. The constraint says so, rather than a comment hoping so.
  (t) => [uniqueIndex("documents_trip_unique").on(t.tripId)],
)

export const places = pgTable(
  "places",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalName: text("canonical_name").notNull(),
    /** Native script, as written on the sign. Often the only name that resolves. */
    localName: text("local_name"),
    city: text("city").notNull(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    googlePlaceId: text("google_place_id"),
    category: placeCategoryEnum("category").notNull().default("other"),
    tags: text("tags").array().notNull().default([]),
    /** A `ScoreSet` from @samsara/core: each named score carries its own explanations. */
    scores: jsonb("scores").notNull().default({}),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    evidenceCount: integer("evidence_count").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    // Dedup's strongest key. Partial-unique would be better once we trust it; not yet.
    index("places_google_id_idx").on(t.googlePlaceId),
    index("places_city_category_idx").on(t.city, t.category),
  ],
)

export const postcards = pgTable(
  "postcards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    kind: postcardKindEnum("kind").notNull(),
    placeId: uuid("place_id").references(() => places.id, { onDelete: "set null" }),
    /** Kind-specific. Narrowed by the renderer, not by the database. */
    payload: jsonb("payload").notNull().default({}),
    /** If these are null the card does not appear on the map. That is the whole rule. */
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    timeStart: timestamp("time_start", { withTimezone: true }),
    timeEnd: timestamp("time_end", { withTimezone: true }),
    /** Evidence ids in the engine's table. Every card can show its receipts. */
    sourceRefs: uuid("source_refs").array().notNull().default([]),
    state: postcardStateEnum("state").notNull().default("fresh"),
    ...timestamps,
  },
  (t) => [index("postcards_trip_state_idx").on(t.tripId, t.state)],
)
