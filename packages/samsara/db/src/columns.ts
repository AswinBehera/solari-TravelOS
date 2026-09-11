import { timestamp } from "drizzle-orm/pg-core"

/**
 * Every engine table carries these. Defined once so no table can quietly disagree
 * about precision or timezone handling.
 */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}

/** Object storage key. The database stores the key; it never stores the bytes. */
export const storageRefType = "text" as const
