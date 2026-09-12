import type { HarvestOutcome, SourceId } from "@samsara/core"
import { harvestRuns, rawItems } from "@samsara/db"
import { and, eq, type TablesRelationalConfig } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type {
  HarvestRunRecord,
  HarvestRunStart,
  HarvestRunStore,
  RawItemRow,
  RawItemStore,
} from "./store.js"

/**
 * The real harvest stores.
 *
 * Typed against `PgDatabase` rather than a concrete client, like the kernel's and
 * the persona store's, so a caller may pass a database composed with its own
 * vertical's tables while this file still touches only engine ones.
 */
type Db = PgDatabase<PgQueryResultHKT, Record<string, unknown>, TablesRelationalConfig>

type RunRow = typeof harvestRuns.$inferSelect

const toRecord = (row: RunRow): HarvestRunRecord => ({
  id: row.id,
  domainId: row.domainId,
  personaId: row.personaId,
  sourceId: row.sourceId,
  query: row.query,
  sessionId: row.sessionId,
  startedAt: row.startedAt,
  endedAt: row.endedAt,
  outcome: row.outcome,
  itemCount: row.itemCount,
})

export class PostgresHarvestRunStore implements HarvestRunStore {
  constructor(private readonly db: Db) {}

  async start(run: HarvestRunStart): Promise<void> {
    await this.db.insert(harvestRuns).values({
      id: run.id,
      domainId: run.domainId,
      personaId: run.personaId,
      sourceId: run.sourceId,
      query: run.query,
      sessionId: run.sessionId,
      startedAt: run.startedAt,
      endedAt: null,
      outcome: "running",
      itemCount: 0,
    })
  }

  /**
   * One statement, and deliberately not read-modify-write.
   *
   * There is nothing to read here — every value is supplied — which is the point:
   * a `finish` that first fetched the row to check it was still `running` would
   * turn the terminal transition into two round trips inside a browser session's
   * deadline, for a check nothing acts on.
   */
  async finish(
    id: string,
    outcome: HarvestOutcome,
    itemCount: number,
    endedAt: Date,
  ): Promise<void> {
    await this.db
      .update(harvestRuns)
      .set({ outcome, itemCount, endedAt, updatedAt: new Date() })
      .where(eq(harvestRuns.id, id))
  }

  async byId(id: string): Promise<HarvestRunRecord | null> {
    const rows = await this.db.select().from(harvestRuns).where(eq(harvestRuns.id, id)).limit(1)
    return rows[0] ? toRecord(rows[0]) : null
  }

  async list(
    filter: { sourceId?: SourceId; personaId?: string } = {},
  ): Promise<HarvestRunRecord[]> {
    const clauses = [
      ...(filter.sourceId ? [eq(harvestRuns.sourceId, filter.sourceId)] : []),
      ...(filter.personaId ? [eq(harvestRuns.personaId, filter.personaId)] : []),
    ]
    const query = this.db.select().from(harvestRuns)
    const rows = clauses.length > 0 ? await query.where(and(...clauses)) : await query
    return rows.map(toRecord)
  }
}

export class PostgresRawItemStore implements RawItemStore {
  constructor(private readonly db: Db) {}

  /**
   * One statement for the batch.
   *
   * A harvest returning forty items must not be forty round trips: they would run
   * inside the session's deadline, and a deadline that expires while inserting is
   * a deadline that expires holding an open browser, which bills for the wait.
   *
   * The empty case returns early because drizzle refuses a `VALUES` list with no
   * rows, and an empty harvest is ordinary rather than exceptional.
   */
  async insertMany(items: readonly RawItemRow[]): Promise<void> {
    if (items.length === 0) return
    await this.db.insert(rawItems).values(
      items.map((item) => ({
        id: item.id,
        harvestRunId: item.harvestRunId,
        sourceId: item.sourceId,
        url: item.url,
        title: item.title,
        text: item.text,
        languageGuess: item.languageGuess,
        mediaRefs: [...item.mediaRefs],
        engagementViews: item.engagement?.views ?? null,
        engagementLikes: item.engagement?.likes ?? null,
        engagementComments: item.engagement?.comments ?? null,
        capturedAt: item.capturedAt,
        rawRef: item.rawRef,
      })),
    )
  }
}
