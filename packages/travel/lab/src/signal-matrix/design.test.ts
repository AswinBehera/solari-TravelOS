import { cellKey, factorEffects } from "@samsara/harvest"
import { describe, expect, it } from "vitest"
import {
  FACTORS,
  MINUTES_PER_CELL,
  QUERIES,
  REPLICATES,
  requestFor,
  runPlan,
  TOP_K,
} from "./design.js"
import type { RankedCellLike } from "./results.js"
import { youtubeSearch } from "./surface.js"

const buildUrl = (r: Parameters<typeof youtubeSearch.buildUrl>[0]) => youtubeSearch.buildUrl(r)

describe("the P1.0 design", () => {
  it("varies the four axes ADR-0015 named, and nothing else", () => {
    // Named here so that adding a fifth axis is a decision somebody makes rather
    // than a doubling of the bill that slips through on a rename.
    expect(Object.keys(FACTORS).sort()).toEqual([
      "egress",
      "locale",
      "queryLanguage",
      "storedRegion",
    ])
  })

  it("is the sixteen cells the plan budgeted, plus two replicates", () => {
    const plan = runPlan(1)
    expect(plan.cells).toBe(16)
    expect(plan.replicates).toBe(2)
    expect(plan.order).toHaveLength(18)
  })

  it("stays inside the ten browser-minute budget the plan set", () => {
    expect(runPlan(1).estimatedMinutes).toBeLessThanOrEqual(10)
  })

  it("replicates cells that are actually in the matrix", () => {
    const keys = new Set(runPlan(1, false).order.map(cellKey))
    for (const replicate of REPLICATES) expect(keys.has(cellKey(replicate))).toBe(true)
  })

  it("can measure every one of its own axes", () => {
    // The property that makes the design a design: for each factor there is at
    // least one pair of cells differing in that factor and nothing else. Asserted
    // here rather than assumed, because a design that cannot isolate an axis
    // spends the same ten minutes and answers a different question.
    const cells: RankedCellLike[] = runPlan(1, false).order.map((assignment) => ({
      assignment,
      items: [],
    }))
    for (const row of factorEffects(cells, TOP_K)) {
      expect(row.pairs, `factor ${row.factor} is not isolated by any pair`).toBeGreaterThan(0)
    }
  })

  it("runs the same order twice from one seed, and a different one from another", () => {
    expect(runPlan(7).order.map(cellKey)).toEqual(runPlan(7).order.map(cellKey))
    expect(runPlan(7).order.map(cellKey)).not.toEqual(runPlan(8).order.map(cellKey))
  })
})

describe("turning an assignment into a request", () => {
  it("carries the egress, the locale, and the clock the locale implies", () => {
    const request = requestFor(
      { egress: "sg", locale: "th-TH", queryLanguage: "th", storedRegion: "unset" },
      buildUrl,
    )
    expect(request.country).toBe("sg")
    expect(request.locale).toBe("th-TH")
    expect(request.timezoneId).toBe("Asia/Bangkok")
    expect(request.query).toBe(QUERIES.th)
  })

  it("lets the viewpoint disagree with the egress, which is the whole point", () => {
    const request = requestFor(
      { egress: "us", locale: "th-TH", queryLanguage: "th", storedRegion: "set" },
      buildUrl,
    )
    expect(request.country).toBe("us")
    expect(request.timezoneId).toBe("Asia/Bangkok")
  })

  it("asks the question in the script the cell names", () => {
    const thai = requestFor(
      { egress: "sg", locale: "en-US", queryLanguage: "th", storedRegion: "unset" },
      buildUrl,
    )
    // A Thai query from an American browser: one of the sixteen, and the cell the
    // README's hypothesis says should still surface local results.
    expect(thai.query).toBe(QUERIES.th)
    expect(thai.locale).toBe("en-US")
  })

  it("refuses an assignment it has no query or zone for", () => {
    expect(() =>
      requestFor(
        { egress: "sg", locale: "fr-FR", queryLanguage: "th", storedRegion: "unset" },
        buildUrl,
      ),
    ).toThrow()
  })
})

describe("the surface", () => {
  it("carries region hints only when the cell asks for them", () => {
    const set = requestFor(
      { egress: "sg", locale: "th-TH", queryLanguage: "th", storedRegion: "set" },
      buildUrl,
    )
    const unset = requestFor(
      { egress: "sg", locale: "th-TH", queryLanguage: "th", storedRegion: "unset" },
      buildUrl,
    )
    expect(set.url).toContain("gl=TH")
    expect(set.url).toContain("hl=th")
    expect(unset.url).not.toContain("gl=")
    expect(unset.url).not.toContain("hl=")
  })

  it("persists the hint past first paint, or the axis measures nothing", () => {
    const url = youtubeSearch.buildUrl({ query: "x", hints: { gl: "TH", hl: "th" } })
    expect(url).toContain("persist_gl=1")
    expect(url).toContain("persist_hl=1")
  })

  it("percent-encodes a Thai query rather than emitting raw script", () => {
    const url = youtubeSearch.buildUrl({ query: QUERIES.th ?? "" })
    expect(url).toMatch(/search_query=(%[0-9A-F]{2})+$/)
  })
})

describe("the budget this run will spend", () => {
  it("is a fraction of a percent of the minutes ceiling", () => {
    // 4,000 minutes is the Phase 8 ceiling; this is the first task that spends
    // more than a rounding error, and it is still under half a percent.
    const share = runPlan(1).estimatedMinutes / 4_000
    expect(share).toBeLessThan(0.005)
    expect(MINUTES_PER_CELL).toBeGreaterThan(0)
  })
})

describe("where the replicates sit in the run order", () => {
  it("spans each replicate pair across the whole run, not across forty seconds", () => {
    // The noise floor has to be measured over the same timescale as the contrasts
    // it calibrates. Two identical sessions back to back agree far more than two
    // sessions ten minutes apart, and using the former as the floor would inflate
    // every effect in the table by the difference.
    const order = runPlan(20260912).order.map(cellKey)
    for (const replicate of REPLICATES) {
      const key = cellKey(replicate)
      const positions = order.flatMap((cell, index) => (cell === key ? [index] : []))
      expect(positions).toHaveLength(2)
      const [first, second] = positions as [number, number]
      expect(second - first).toBeGreaterThanOrEqual(order.length - REPLICATES.length - 1)
    }
  })
})
