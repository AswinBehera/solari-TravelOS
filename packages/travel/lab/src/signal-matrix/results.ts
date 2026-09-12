import type { Assignment } from "@samsara/harvest"

/** What the report hands to `@samsara/harvest`: a cell and what it returned. */
export interface RankedCellLike {
  assignment: Assignment
  items: readonly string[]
}

/** One executed cell, exactly as it was run and exactly as it answered. */
export interface CellResult {
  assignment: Assignment
  /** Which pass through the design this was. 0 for the matrix, 1+ for replicates. */
  replicate: number
  url: string
  startedAt: string
  /** The identifiers, best first. Empty when the cell was refused. */
  items: string[]
  minutes: number
  sessionId: string | null
  /** Set when the session failed; `kind` is the kernel's own classification. */
  error?: { kind: string; message: string }
  /** Set when the page loaded but was not the page we asked for. */
  refusedBy?: string
}

/**
 * A whole run, self-describing.
 *
 * Everything needed to re-read the numbers months later is in the file: the
 * factor levels, the seed that fixed the order, the surface, the depth, the
 * queries. A results file that requires the code that produced it to interpret it
 * is a results file with a shelf life.
 */
export interface RunFile {
  experiment: "signal-matrix"
  surface: string
  topK: number
  seed: number
  startedAt: string
  finishedAt: string
  factors: Record<string, readonly string[]>
  queries: Record<string, string>
  minutesSpent: number
  cells: CellResult[]
}
