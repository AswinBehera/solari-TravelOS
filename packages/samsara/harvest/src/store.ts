import { randomUUID } from "node:crypto"
import type { Engagement, HarvestOutcome, SourceId, StorageRef } from "@samsara/core"
import type { Capture } from "@samsara/sources"

/**
 * Where a run and its items are written, and where the untouched bytes go.
 *
 * Three ports rather than one, because they have three different lifetimes and
 * two different storage systems behind them: a run row is a small mutable record,
 * items are a bulk append, and an archived capture is an object in a bucket that
 * nothing in this package will ever read back. Collapsing them would mean a test
 * for the run's state machine needed a bucket.
 */

/** What is known when a run starts. `id` is minted by the caller so it can log it. */
export interface HarvestRunStart {
  id: string
  domainId: string
  personaId: string
  sourceId: SourceId
  query: string
  sessionId: string
  startedAt: Date
}

export interface HarvestRunRecord extends HarvestRunStart {
  endedAt: Date | null
  outcome: HarvestOutcome
  itemCount: number
}

export interface HarvestRunStore {
  start(run: HarvestRunStart): Promise<void>
  /** Terminal transition. Sets `endedAt`, `outcome` and the count in one write. */
  finish(id: string, outcome: HarvestOutcome, itemCount: number, endedAt: Date): Promise<void>
  byId(id: string): Promise<HarvestRunRecord | null>
  list(filter?: { sourceId?: SourceId; personaId?: string }): Promise<HarvestRunRecord[]>
}

/** A parsed item, completed with the three things a parser is not allowed to know. */
export interface RawItemRow {
  id: string
  harvestRunId: string
  sourceId: SourceId
  url: string
  title: string | null
  text: string
  languageGuess: string | null
  mediaRefs: readonly string[]
  engagement: Engagement | null
  capturedAt: Date
  rawRef: StorageRef
}

export interface RawItemStore {
  /**
   * One call for the whole batch, not one per item.
   *
   * A harvest returning forty items should be one statement. Forty round trips
   * inside a browser session's deadline is a way to have the deadline expire
   * holding an open browser, which bills for the wait.
   */
  insertMany(items: readonly RawItemRow[]): Promise<void>
}

/**
 * Object storage for the capture, keyed by run.
 *
 * The engine never dereferences a `StorageRef` — it hands it to whoever asks. This
 * port exists so that the one thing the archive *must* guarantee is stated
 * somewhere: the bytes stored are the bytes received, unmodified. A re-parse that
 * runs against a cleaned-up copy is not a re-parse, it is a second opinion about
 * a document nobody has.
 */
export interface CaptureArchive {
  put(runId: string, capture: Capture<unknown>): Promise<StorageRef>
}

// ---------------------------------------------------------------------------

export class MemoryHarvestRunStore implements HarvestRunStore {
  readonly runs = new Map<string, HarvestRunRecord>()

  async start(run: HarvestRunStart): Promise<void> {
    if (this.runs.has(run.id)) throw new Error(`harvest run already started: ${run.id}`)
    this.runs.set(run.id, { ...run, endedAt: null, outcome: "running", itemCount: 0 })
  }

  async finish(
    id: string,
    outcome: HarvestOutcome,
    itemCount: number,
    endedAt: Date,
  ): Promise<void> {
    const run = this.runs.get(id)
    if (!run) throw new Error(`no such harvest run: ${id}`)
    this.runs.set(id, { ...run, outcome, itemCount, endedAt })
  }

  async byId(id: string): Promise<HarvestRunRecord | null> {
    return this.runs.get(id) ?? null
  }

  async list(
    filter: { sourceId?: SourceId; personaId?: string } = {},
  ): Promise<HarvestRunRecord[]> {
    return [...this.runs.values()].filter(
      (r) =>
        (filter.sourceId === undefined || r.sourceId === filter.sourceId) &&
        (filter.personaId === undefined || r.personaId === filter.personaId),
    )
  }
}

export class MemoryRawItemStore implements RawItemStore {
  readonly items: RawItemRow[] = []

  async insertMany(items: readonly RawItemRow[]): Promise<void> {
    this.items.push(...items)
  }
}

/**
 * Keeps captures in a Map. For tests, and for a local run with no bucket.
 *
 * The ref it returns has the same shape as a real key, so a row written against
 * this archive is not distinguishable by shape from one written against Supabase
 * Storage — which matters, because the alternative is a `memory://` scheme that
 * ends up in a production row after somebody boots without credentials.
 */
export class MemoryCaptureArchive implements CaptureArchive {
  readonly objects = new Map<StorageRef, Capture<unknown>>()

  async put(runId: string, capture: Capture<unknown>): Promise<StorageRef> {
    const ref = `captures/${capture.sourceId}/${runId}/${randomUUID()}.json`
    this.objects.set(ref, capture)
    return ref
  }
}
