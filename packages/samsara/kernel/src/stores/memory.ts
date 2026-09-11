import type { CounterKey, CounterStore } from "../budget.js"
import { counterKeyString } from "../budget.js"
import type { SessionRecord, SessionStore } from "../registry.js"

/**
 * In-memory ports. Two uses, and only two:
 *
 * - unit tests, which must be able to drive a meter past its ceiling without a
 *   database and without spending anything;
 * - a dry run, where forgetting is the point.
 *
 * Never in a scheduled runner. A counter that resets when the process exits is
 * exactly the failure ADR-0014 moved counters into Postgres to avoid.
 */

export class MemoryCounterStore implements CounterStore {
  private readonly totals = new Map<string, number>()

  async read(keys: readonly CounterKey[]): Promise<Map<string, number>> {
    const out = new Map<string, number>()
    for (const key of keys) {
      const k = counterKeyString(key)
      out.set(k, this.totals.get(k) ?? 0)
    }
    return out
  }

  async add(key: CounterKey, amount: number): Promise<number> {
    const k = counterKeyString(key)
    const next = (this.totals.get(k) ?? 0) + amount
    this.totals.set(k, next)
    return next
  }

  /** Test affordance: set a counter straight to a value without running anything. */
  seed(key: CounterKey, amount: number): void {
    this.totals.set(counterKeyString(key), amount)
  }
}

export class MemorySessionStore implements SessionStore {
  readonly rows = new Map<string, SessionRecord>()

  async open(row: SessionRecord): Promise<void> {
    this.rows.set(row.id, { ...row })
  }

  async close(id: string, patch: Partial<SessionRecord>): Promise<void> {
    const existing = this.rows.get(id)
    if (!existing) return
    this.rows.set(id, { ...existing, ...patch })
  }

  async findOpen(): Promise<SessionRecord[]> {
    return [...this.rows.values()].filter((r) => r.outcome === "running")
  }
}
