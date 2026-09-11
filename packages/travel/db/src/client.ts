import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { schema } from "./schema.js"

export type Db = ReturnType<typeof createDb>["db"]

/**
 * One connection pool per process. `apps/api` and `apps/worker` each make one at
 * boot and pass it down; nothing calls this per request.
 *
 * `max` is deliberately small. Supabase's pooler has a connection ceiling, and a
 * worker that opens browsers is bound by Solari minutes long before it is bound by
 * database concurrency.
 */
export function createDb(connectionString: string, options?: { max?: number }) {
  const sql = postgres(connectionString, { max: options?.max ?? 5 })
  return { db: drizzle(sql, { schema }), sql }
}
