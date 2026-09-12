/**
 * A factorial design, expanded.
 *
 * The question this exists to answer is "which of these signals actually moves
 * the result, and by how much" — and the only honest way to answer it is to vary
 * one signal at a time while holding the rest still. That requires the full
 * product of levels, not a hand-picked list of interesting combinations, because
 * a hand-picked list has no pair that differs in exactly one factor and therefore
 * supports no controlled comparison at all.
 *
 * Nothing here knows what a factor means. The caller names the axes.
 */

/** Named axes and the values each can take. Level order is the caller's. */
export type Factors = Readonly<Record<string, readonly string[]>>

/** One point in the design: every factor, one level each. */
export type Assignment = Readonly<Record<string, string>>

/**
 * Every combination, in a deterministic order: factor names sorted, the last one
 * varying fastest. Deterministic because a run is compared against an earlier
 * run often enough that cell N ought to mean the same thing both times.
 *
 * A factor with no levels is a thrown error rather than an empty product. The
 * empty product is the correct arithmetic answer and a useless experimental one:
 * it turns a typo in a config into a run that opens no sessions, spends nothing,
 * and reports success.
 */
export function expand(factors: Factors): Assignment[] {
  const names = Object.keys(factors).sort()
  for (const name of names) {
    if (factors[name]?.length === 0) {
      throw new RangeError(`factor "${name}" has no levels, so the design is empty`)
    }
  }
  let cells: Assignment[] = [{}]
  for (const name of names) {
    const next: Assignment[] = []
    for (const cell of cells) {
      for (const level of factors[name] ?? []) {
        next.push({ ...cell, [name]: level })
      }
    }
    cells = next
  }
  return cells
}

/** How many cells `expand` will produce, without building them. For budgeting. */
export function cellCount(factors: Factors): number {
  return Object.values(factors).reduce((n, levels) => n * levels.length, 1)
}

/**
 * A stable identity for a cell: `a=1; b=2`, names sorted.
 *
 * Sorted rather than insertion-ordered so that two assignments built by different
 * code paths — one from `expand`, one written by hand in a config — compare equal
 * when they mean the same thing.
 */
export function cellKey(assignment: Assignment): string {
  return Object.keys(assignment)
    .sort()
    .map((name) => `${name}=${assignment[name]}`)
    .join("; ")
}

/** The factor names on which two assignments disagree, sorted. */
export function differingFactors(a: Assignment, b: Assignment): string[] {
  const names = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...names].filter((name) => a[name] !== b[name]).sort()
}

/**
 * A deterministic shuffle, so a long run does not confound its own order.
 *
 * Sixteen cells executed back to back take ten minutes, and a ranked surface is
 * not the same surface at minute ten that it was at minute zero. Run them in
 * design order and every "effect" of the slowest-varying factor carries whatever
 * drifted during the run. Randomising the order breaks that; seeding the
 * randomness means a run can be replayed exactly, and means the order itself is
 * something to record rather than something that happened.
 *
 * mulberry32. Not cryptographic, and nothing here wants it to be.
 */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const a = out[i]
    const b = out[j]
    if (a !== undefined && b !== undefined) {
      out[i] = b
      out[j] = a
    }
  }
  return out
}
