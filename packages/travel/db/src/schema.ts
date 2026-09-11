import { samsaraSchema } from "@samsara/db"
import * as travelEnums from "./enums.js"
import * as travelTables from "./tables.js"

/**
 * The whole database in one module.
 *
 * The star re-exports below are not stylistic: drizzle-kit reads a schema file's
 * top-level exports, so an object alone is invisible to it and generates an empty
 * migration. Engine tables come in from @samsara/db unchanged — never redeclared,
 * because two declarations of one table is how a migration history starts lying.
 */
export * from "@samsara/db"
export * from "./enums.js"
export * from "./tables.js"

/** The same tables as one object, for composing into a Drizzle client. */
export const schema = {
  ...samsaraSchema,
  ...travelEnums,
  ...travelTables,
} as const

export type Schema = typeof schema
