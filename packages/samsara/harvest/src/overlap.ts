import { type Assignment, cellKey, differingFactors } from "./matrix.js"

/**
 * Comparing two ranked lists of identifiers, and turning a grid of those
 * comparisons into a statement about which factor mattered.
 *
 * Deliberately string-in, number-out: the identifiers are opaque here. What they
 * are — result URLs, item ids, anything stable and comparable — is the caller's
 * business, and keeping it that way is what lets this be tested without a network.
 */

/** One cell of the design, with what it returned, best first. */
export interface RankedCell {
  assignment: Assignment
  /** Ranked identifiers. Duplicates are dropped, first occurrence winning. */
  items: readonly string[]
}

export interface OverlapAtK {
  k: number
  /** Identifiers present in both lists' top k. */
  shared: number
  /**
   * The largest intersection the two lists could possibly have had.
   *
   * `min(k, |a|, |b|)`, not k. A surface that answered with twelve results cannot
   * share twenty, and dividing by twenty would report that shortfall as a signal
   * effect — reading a thin page as a changed one. Carried in the result rather
   * than folded away, because a run where this is routinely below k is a run
   * whose numbers should be read differently.
   */
  comparable: number
  /** `shared / comparable`, or 0 when there is nothing to compare. */
  overlap: number
}

/** Top k, duplicates removed, order preserved. */
export function topK(items: readonly string[], k: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
    if (out.length === k) break
  }
  return out
}

export function overlapAt(a: readonly string[], b: readonly string[], k: number): OverlapAtK {
  const left = topK(a, k)
  const right = topK(b, k)
  const rightSet = new Set(right)
  const shared = left.filter((item) => rightSet.has(item)).length
  const comparable = Math.min(left.length, right.length)
  return { k, shared, comparable, overlap: comparable === 0 ? 0 : shared / comparable }
}

/**
 * Mean absolute rank change, over identifiers both lists returned. `null` when
 * they share nothing.
 *
 * Overlap alone cannot tell "the same twenty results, reordered" from "the same
 * twenty results, identical" — and reordering is most of what a ranker does when
 * a weak signal changes. A pair with high overlap and a large shift is a real
 * effect that the headline number would otherwise report as none.
 */
export function meanRankShift(
  a: readonly string[],
  b: readonly string[],
  k: number,
): number | null {
  const left = topK(a, k)
  const rightRank = new Map(topK(b, k).map((item, index) => [item, index]))
  let total = 0
  let count = 0
  for (const [index, item] of left.entries()) {
    const other = rightRank.get(item)
    if (other === undefined) continue
    total += Math.abs(index - other)
    count += 1
  }
  return count === 0 ? null : total / count
}

export interface CellPair {
  a: Assignment
  b: Assignment
  /** Factor names the two cells disagree on. Empty means they are replicates. */
  differing: string[]
  overlap: OverlapAtK
  meanRankShift: number | null
}

/** Every unordered pair of cells, compared. */
export function pairwise(cells: readonly RankedCell[], k: number): CellPair[] {
  const pairs: CellPair[] = []
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const left = cells[i]
      const right = cells[j]
      if (!left || !right) continue
      pairs.push({
        a: left.assignment,
        b: right.assignment,
        differing: differingFactors(left.assignment, right.assignment),
        overlap: overlapAt(left.items, right.items, k),
        meanRankShift: meanRankShift(left.items, right.items, k),
      })
    }
  }
  return pairs
}

/**
 * How much two runs of the *same* cell disagree — the number every other number
 * here has to be read against.
 *
 * Ranked surfaces are not deterministic: two identical sessions a minute apart
 * return different lists. Without this, an effect of 0.3 is unreadable, because
 * the honest question is whether 0.3 is larger than what changing nothing at all
 * produces. `null` when the design has no repeated cell, which is itself the
 * finding: a design with no replicates cannot distinguish a signal from weather.
 */
export function noiseFloor(cells: readonly RankedCell[], k: number): number | null {
  const replicates = pairwise(cells, k).filter((pair) => pair.differing.length === 0)
  if (replicates.length === 0) return null
  return replicates.reduce((sum, pair) => sum + pair.overlap.overlap, 0) / replicates.length
}

export interface FactorEffect {
  factor: string
  /** Pairs that differ in this factor and nothing else. Zero means unmeasured. */
  pairs: number
  /** Mean overlap across those pairs. `null` when there were none. */
  meanOverlap: number | null
  /** `1 - meanOverlap`: how much of the result the factor displaced. */
  effect: number | null
  /** Mean rank movement among the results that survived the change. */
  meanRankShift: number | null
}

/**
 * The headline: one row per factor, largest effect first.
 *
 * Only pairs differing in *exactly* one factor count. A pair that differs in two
 * is real data about interaction and says nothing about either factor alone, so
 * attributing it to both would inflate whichever one happens to be weak.
 *
 * Factors with no such pair are reported with `pairs: 0` rather than omitted. A
 * missing row reads as "no effect"; an explicit zero reads as "not measured",
 * and a design that cannot measure one of its own axes should say so out loud.
 */
export function factorEffects(cells: readonly RankedCell[], k: number): FactorEffect[] {
  const names = new Set<string>()
  for (const cell of cells) for (const name of Object.keys(cell.assignment)) names.add(name)

  const pairs = pairwise(cells, k)
  const rows: FactorEffect[] = [...names].map((factor) => {
    const relevant = pairs.filter(
      (pair) => pair.differing.length === 1 && pair.differing[0] === factor,
    )
    if (relevant.length === 0) {
      return { factor, pairs: 0, meanOverlap: null, effect: null, meanRankShift: null }
    }
    const meanOverlap =
      relevant.reduce((sum, pair) => sum + pair.overlap.overlap, 0) / relevant.length
    const shifts = relevant.map((pair) => pair.meanRankShift).filter((s): s is number => s !== null)
    return {
      factor,
      pairs: relevant.length,
      meanOverlap,
      effect: 1 - meanOverlap,
      meanRankShift: shifts.length === 0 ? null : shifts.reduce((a, b) => a + b, 0) / shifts.length,
    }
  })

  return rows.sort((a, b) => {
    if (a.effect === null) return b.effect === null ? a.factor.localeCompare(b.factor) : 1
    if (b.effect === null) return -1
    return b.effect - a.effect || a.factor.localeCompare(b.factor)
  })
}

/** Cells grouped by identity, so replicates of one cell arrive together. */
export function groupByCell(cells: readonly RankedCell[]): Map<string, RankedCell[]> {
  const groups = new Map<string, RankedCell[]>()
  for (const cell of cells) {
    const key = cellKey(cell.assignment)
    const existing = groups.get(key)
    if (existing) existing.push(cell)
    else groups.set(key, [cell])
  }
  return groups
}
