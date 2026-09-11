import { defineConfig } from "drizzle-kit"

/**
 * @dt/db owns the single migration history for the whole database, engine tables
 * included — which is why `schema` points at the composed object rather than at this
 * package's own tables.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/doen_thang",
  },
  strict: true,
  verbose: true,
})
