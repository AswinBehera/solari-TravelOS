import {
  type Assignment,
  cellCount,
  cellKey,
  expand,
  type Factors,
  shuffle,
} from "@samsara/harvest"
import type { SurfaceRequest } from "./surface.js"

/**
 * P1.0 — the signal-matrix experiment (ADR-0015).
 *
 * ADR-0015 claims that a browsing viewpoint is a *stack* of signals and that the
 * egress IP is the weakest of them. That is an informed hypothesis and it has
 * been steering the architecture for a week. This is the measurement.
 *
 * One question, asked sixteen ways, and the answer to "which of these actually
 * moved the results" sets the priority order for every adapter in P1.3 to P1.6.
 * If it turns out the IP dominates after all, the plan is wrong and the cheapest
 * possible moment to learn that is before four adapters are built on top of it.
 *
 * This file is the travel half and lives on the `@dt/*` side of the seam on
 * purpose: the arithmetic is in `@samsara/harvest`, which has never heard of
 * Bangkok.
 */

/**
 * The axes.
 *
 * `locale` deliberately bundles two signals — the browser's language and its
 * clock — because ADR-0015's stack bundles them too ("browser locale and
 * timezone", one rung). Splitting them would double the run to 32 cells to
 * separate two things we have no plan to set independently. It is a confound,
 * it is a chosen one, and the result table has to say so.
 */
export const FACTORS = {
  /** Where the packets come from. The rung ADR-0015 expects to matter least. */
  egress: ["sg", "us"],
  /** `navigator.language` and the clock together. */
  locale: ["th-TH", "en-US"],
  /** The script the question is asked in. Expected to matter most. */
  queryLanguage: ["th", "en"],
  /** Region and language hints carried on the request, as a signed-out user's would be. */
  storedRegion: ["set", "unset"],
} as const satisfies Factors

/**
 * The question, in both languages. Not translations of each other word for word
 * — what a Thai speaker types is not what an English speaker types transliterated,
 * and using a literal translation would measure our Thai rather than the platform's.
 */
export const QUERIES: Record<string, string> = {
  th: "ที่เที่ยวกรุงเทพ",
  en: "things to do in Bangkok",
}

/** What each locale implies about the clock. */
const TIMEZONES: Record<string, string> = {
  "th-TH": "Asia/Bangkok",
  "en-US": "America/New_York",
}

/** Region hints, applied only when `storedRegion` is `set`. */
const REGION_HINTS: Record<string, { gl: string; hl: string }> = {
  "th-TH": { gl: "TH", hl: "th" },
  "en-US": { gl: "US", hl: "en" },
}

/**
 * Two cells run twice, to measure what changing nothing produces.
 *
 * Without these the whole table is unreadable. A ranked surface returns a
 * different list to two identical sessions a minute apart, so an overlap of 0.7
 * between two cells means nothing until you know whether repeating one cell also
 * gives 0.7. The plan budgeted sixteen cells; these two extra runs cost about a
 * minute and are the difference between a measurement and a set of numbers.
 *
 * The corners, because they are the two cells the product cares about: everything
 * local, and everything foreign.
 */
export const REPLICATES: Assignment[] = [
  { egress: "sg", locale: "th-TH", queryLanguage: "th", storedRegion: "set" },
  { egress: "us", locale: "en-US", queryLanguage: "en", storedRegion: "unset" },
]

/** Top-of-list depth the plan asks about. */
export const TOP_K = 20

/** Rough per-session cost, from the P0.8 live run plus page load and settle. */
export const MINUTES_PER_CELL = 0.5

export interface RunPlan {
  order: Assignment[]
  seed: number
  cells: number
  replicates: number
  estimatedMinutes: number
}

/**
 * The full run, in the order it will execute.
 *
 * Shuffled, because sixteen sessions take ten minutes and the surface at minute
 * ten is not the surface at minute zero. In design order, the slowest-varying
 * factor absorbs every drift that happened during the run and reports it as an
 * effect. Seeded, so the order is reproducible and recorded rather than lost.
 *
 * The replicates are then pulled to the front and their repeats pushed to the
 * back, deliberately overriding the shuffle for those four sessions. A replicate
 * that happens to land next to its original measures how much the surface moves
 * in forty seconds, while every contrast it is meant to calibrate spans ten
 * minutes — so it would report a noise floor far quieter than the noise actually
 * in the comparisons, and every effect below would be inflated by the difference.
 * Spanning the whole run is the conservative reading, and conservative is the
 * right direction for the number everything else is divided by.
 */
export function runPlan(seed: number, withReplicates = true): RunPlan {
  const base = expand(FACTORS)
  const shuffled = shuffle(base, seed)
  if (!withReplicates) {
    return {
      order: shuffled,
      seed,
      cells: base.length,
      replicates: 0,
      estimatedMinutes: base.length * MINUTES_PER_CELL,
    }
  }
  const replicateKeys = new Set(REPLICATES.map(cellKey))
  const first = shuffled.filter((cell) => replicateKeys.has(cellKey(cell)))
  const rest = shuffled.filter((cell) => !replicateKeys.has(cellKey(cell)))
  const order = [...first, ...rest, ...first]
  return {
    order,
    seed,
    cells: base.length,
    replicates: first.length,
    estimatedMinutes: order.length * MINUTES_PER_CELL,
  }
}

export const TOTAL_CELLS = cellCount(FACTORS)

export interface CellRequest {
  /** Kernel launch options. */
  country: string
  locale: string
  timezoneId: string
  /** The surface to load. */
  url: string
  query: string
}

/**
 * An assignment turned into something the kernel and the surface can take.
 *
 * The one line worth reading twice is the egress: `sg` is not a stand-in for
 * Thailand because we like Singapore, it is the nearest available pool — the
 * provider carries no Thai residential egress at all (see `countries.ts`). Which
 * is exactly why this experiment exists: if the IP rung is weak, that absence is
 * an inconvenience, and if it is strong, it is a wall.
 */
export function requestFor(
  assignment: Assignment,
  buildUrl: (request: SurfaceRequest) => string,
): CellRequest {
  const locale = assignment.locale ?? "en-US"
  const queryLanguage = assignment.queryLanguage ?? "en"
  const query = QUERIES[queryLanguage]
  const timezoneId = TIMEZONES[locale]
  const hints = assignment.storedRegion === "set" ? REGION_HINTS[locale] : undefined
  if (!query || !timezoneId) {
    throw new RangeError(`no query or zone for ${JSON.stringify(assignment)}`)
  }
  return {
    country: assignment.egress ?? "us",
    locale,
    timezoneId,
    query,
    url: buildUrl(hints ? { query, hints } : { query }),
  }
}
