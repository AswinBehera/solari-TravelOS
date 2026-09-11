import { budgetCounters, sessions } from "@samsara/db"
import { and, eq, inArray, sql } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { CounterKey, CounterStore } from "../budget.js"
import { counterKeyString } from "../budget.js"
import type { SessionRecord, SessionStore } from "../registry.js"

/**
 * The real ports: counters and session rows in Postgres.
 *
 * Typed against `PgDatabase` rather than a concrete client so that a caller can
 * pass a database composed with its own vertical's tables. The kernel only ever
 * touches engine tables, which is the seam holding at runtime rather than only in
 * the type system.
 */
type Db = PgDatabase<PgQueryResultHKT, Record<string, never>>

export class PostgresCounterStore implements CounterStore {
  constructor(private readonly db: Db) {}

  async read(keys: readonly CounterKey[]): Promise<Map<string, number>> {
    const out = new Map<string, number>()
    for (const key of keys) out.set(counterKeyString(key), 0)
    if (keys.length === 0) return out

    // One round trip for all three windows. The guard runs before every session,
    // and on the free Hyperdrive plan (100k queries/day) three queries where one
    // will do is a meter of its own.
    const rows = await this.db
      .select({
        meter: budgetCounters.meter,
        window: budgetCounters.window,
        windowKey: budgetCounters.windowKey,
        amount: budgetCounters.amount,
      })
      .from(budgetCounters)
      .where(inArray(budgetCounters.windowKey, [...new Set(keys.map((k) => k.windowKey))]))

    for (const row of rows) {
      const k = counterKeyString({
        meter: row.meter,
        window: row.window,
        windowKey: row.windowKey,
      })
      if (out.has(k)) out.set(k, row.amount)
    }
    return out
  }

  async add(key: CounterKey, amount: number): Promise<number> {
    // Atomic upsert against the unique index. Two runners incrementing the same
    // counter must sum, not race — the alternative is a read-modify-write that
    // silently loses one runner's spend, which is the one bug a budget guard
    // cannot be allowed to have.
    const [row] = await this.db
      .insert(budgetCounters)
      .values({ meter: key.meter, window: key.window, windowKey: key.windowKey, amount })
      .onConflictDoUpdate({
        target: [budgetCounters.meter, budgetCounters.window, budgetCounters.windowKey],
        set: {
          amount: sql`${budgetCounters.amount} + ${amount}`,
          updatedAt: new Date(),
        },
      })
      .returning({ amount: budgetCounters.amount })
    return row?.amount ?? amount
  }
}

export class PostgresSessionStore implements SessionStore {
  constructor(private readonly db: Db) {}

  async open(row: SessionRecord): Promise<void> {
    await this.db.insert(sessions).values({
      id: row.id,
      purpose: row.purpose,
      ownerId: row.ownerId,
      domainId: row.domainId,
      personaId: row.personaId,
      country: row.country,
      locale: row.locale,
      timezoneId: row.timezoneId,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      minutes: row.minutes,
      outcome: row.outcome,
      recordingRef: row.recordingRef,
    })
  }

  async close(id: string, patch: Partial<SessionRecord>): Promise<void> {
    await this.db
      .update(sessions)
      .set({
        ...(patch.endedAt !== undefined ? { endedAt: patch.endedAt } : {}),
        ...(patch.minutes !== undefined ? { minutes: patch.minutes } : {}),
        ...(patch.outcome !== undefined ? { outcome: patch.outcome } : {}),
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, id))
  }

  async findOpen(): Promise<SessionRecord[]> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.outcome, "running")))
    return rows.map((r) => ({
      id: r.id,
      purpose: r.purpose,
      ownerId: r.ownerId,
      domainId: r.domainId,
      personaId: r.personaId,
      country: r.country,
      locale: r.locale,
      timezoneId: r.timezoneId,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      minutes: r.minutes,
      outcome: r.outcome,
      recordingRef: r.recordingRef,
    }))
  }
}
