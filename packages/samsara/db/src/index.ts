// @samsara/db — Drizzle tables for the engine (plan section 3.1).
//
// This package exports table definitions and nothing else. It owns no migrations:
// there is one database and one migration history, and @dt/db holds it. If Samsara is
// ever extracted to its own repo, the folder splits then, not now.

export * from "./enums.js"
export * from "./tables.js"

import * as enums from "./enums.js"
import * as tables from "./tables.js"

/**
 * The engine's schema, as one object, for composing into a database client.
 * A consumer spreads this alongside its own tables; nobody re-declares these.
 */
export const samsaraSchema = { ...enums, ...tables } as const

export const PACKAGE = "@samsara/db" as const
