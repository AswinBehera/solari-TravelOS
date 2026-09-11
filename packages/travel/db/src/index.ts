// @dt/db — travel tables, composed with the engine's, plus the one migration history.
//
// One Postgres, one migrations/ folder, two schema modules. @samsara/db exports table
// definitions only; this package is where they become a database.

export * from "./client.js"
export * from "./schema.js"

export const PACKAGE = "@dt/db" as const
