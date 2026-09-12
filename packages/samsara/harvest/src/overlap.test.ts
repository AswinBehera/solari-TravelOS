import { describe, expect, it } from "vitest"
import type { RankedCell } from "./overlap.js"
import {
  factorEffects,
  groupByCell,
  meanRankShift,
  noiseFloor,
  overlapAt,
  pairwise,
  topK,
} from "./overlap.js"

const ids = (n: number, prefix = "u") => Array.from({ length: n }, (_, i) => `${prefix}${i}`)

describe("topK", () => {
  it("drops duplicates, first occurrence winning", () => {
    expect(topK(["a", "b", "a", "c"], 3)).toEqual(["a", "b", "c"])
  })

  it("returns what there is when the list is shorter than k", () => {
    expect(topK(["a", "b"], 20)).toEqual(["a", "b"])
  })
})

describe("overlap at k", () => {
  it("is 1 for identical lists and 0 for disjoint ones", () => {
    expect(overlapAt(ids(20), ids(20), 20).overlap).toBe(1)
    expect(overlapAt(ids(20), ids(20, "v"), 20).overlap).toBe(0)
  })

  it("ignores order", () => {
    expect(overlapAt(["a", "b", "c"], ["c", "b", "a"], 3).overlap).toBe(1)
  })

  it("divides by what could have been shared, not by k", () => {
    // A surface that answered with ten results cannot share twenty. Dividing by
    // twenty would report the short answer as a signal effect.
    const short = ids(10)
    const long = ids(20)
    const result = overlapAt(short, long, 20)
    expect(result.shared).toBe(10)
    expect(result.comparable).toBe(10)
    expect(result.overlap).toBe(1)
  })

  it("carries the shortfall so a thin run is visible in the output", () => {
    expect(overlapAt(ids(12), ids(20), 20).comparable).toBe(12)
  })

  it("is 0, not NaN, when a cell returned nothing", () => {
    expect(overlapAt([], ids(20), 20)).toEqual({ k: 20, shared: 0, comparable: 0, overlap: 0 })
  })
})

describe("mean rank shift", () => {
  it("is 0 when the same results come back in the same order", () => {
    expect(meanRankShift(ids(5), ids(5), 20)).toBe(0)
  })

  it("separates 'reordered' from 'unchanged', which overlap alone cannot", () => {
    const a = ["x", "y", "z"]
    const b = ["z", "y", "x"]
    expect(overlapAt(a, b, 3).overlap).toBe(1)
    expect(meanRankShift(a, b, 3)).toBeCloseTo((2 + 0 + 2) / 3)
  })

  it("is null when nothing survived the change", () => {
    expect(meanRankShift(ids(5), ids(5, "v"), 20)).toBeNull()
  })
})

describe("pairwise", () => {
  it("compares each unordered pair once and labels replicates as differing in nothing", () => {
    const cells: RankedCell[] = [
      { assignment: { a: "1" }, items: ids(5) },
      { assignment: { a: "2" }, items: ids(5) },
      { assignment: { a: "1" }, items: ids(5) },
    ]
    const pairs = pairwise(cells, 20)
    expect(pairs).toHaveLength(3)
    expect(pairs.filter((p) => p.differing.length === 0)).toHaveLength(1)
  })
})

describe("the noise floor", () => {
  it("is the mean agreement between repeated runs of one cell", () => {
    const cells: RankedCell[] = [
      { assignment: { a: "1" }, items: ["x", "y", "z", "w"] },
      { assignment: { a: "1" }, items: ["x", "y", "z", "q"] },
    ]
    expect(noiseFloor(cells, 20)).toBeCloseTo(0.75)
  })

  it("is null when the design never repeats a cell, because then there is no floor", () => {
    const cells: RankedCell[] = [
      { assignment: { a: "1" }, items: ids(5) },
      { assignment: { a: "2" }, items: ids(5) },
    ]
    expect(noiseFloor(cells, 20)).toBeNull()
  })
})

describe("factor effects", () => {
  /**
   * Two factors over four cells. `loud` replaces the whole result; `quiet`
   * changes one of four. The arithmetic is checkable by hand, which is the point
   * of a fixture this small.
   */
  const design: RankedCell[] = [
    { assignment: { loud: "off", quiet: "off" }, items: ["a", "b", "c", "d"] },
    { assignment: { loud: "off", quiet: "on" }, items: ["a", "b", "c", "z"] },
    { assignment: { loud: "on", quiet: "off" }, items: ["p", "q", "r", "s"] },
    { assignment: { loud: "on", quiet: "on" }, items: ["p", "q", "r", "t"] },
  ]

  it("ranks the factor that moved the result first", () => {
    const [first, second] = factorEffects(design, 20)
    expect(first?.factor).toBe("loud")
    expect(first?.effect).toBe(1)
    expect(second?.factor).toBe("quiet")
    expect(second?.effect).toBeCloseTo(0.25)
  })

  it("counts only pairs that differ in exactly one factor", () => {
    // Six pairs across four cells; two isolate `loud`, two isolate `quiet`, and
    // the two diagonal pairs isolate neither and are attributed to neither.
    const effects = factorEffects(design, 20)
    expect(effects.map((e) => e.pairs)).toEqual([2, 2])
    expect(pairwise(design, 20)).toHaveLength(6)
  })

  it("reports an unmeasured factor as null rather than omitting it", () => {
    // Only one level of `quiet` was ever run, so nothing isolates it. Saying
    // nothing would read as "no effect"; the honest answer is "not measured".
    const partial: RankedCell[] = [
      { assignment: { loud: "off", quiet: "off" }, items: ["a", "b"] },
      { assignment: { loud: "on", quiet: "off" }, items: ["p", "q"] },
    ]
    const effects = factorEffects(partial, 20)
    expect(effects.map((e) => e.factor)).toEqual(["loud", "quiet"])
    const unmeasured = effects.find((e) => e.factor === "quiet")
    expect(unmeasured).toMatchObject({ pairs: 0, meanOverlap: null, effect: null })
  })

  it("averages over replicates instead of being confused by them", () => {
    const withReplicates: RankedCell[] = [
      ...design,
      { assignment: { loud: "off", quiet: "off" }, items: ["a", "b", "c", "d"] },
    ]
    const effects = factorEffects(withReplicates, 20)
    expect(effects.find((e) => e.factor === "loud")?.pairs).toBe(3)
    expect(effects.find((e) => e.factor === "loud")?.effect).toBe(1)
  })

  it("reports rank movement among the results a factor did not displace", () => {
    const reordering: RankedCell[] = [
      { assignment: { shuffle: "off" }, items: ["a", "b", "c"] },
      { assignment: { shuffle: "on" }, items: ["c", "b", "a"] },
    ]
    const [effect] = factorEffects(reordering, 20)
    expect(effect?.effect).toBe(0)
    expect(effect?.meanRankShift).toBeCloseTo(4 / 3)
  })
})

describe("grouping", () => {
  it("gathers replicates of one cell under one key", () => {
    const cells: RankedCell[] = [
      { assignment: { a: "1", b: "2" }, items: [] },
      { assignment: { b: "2", a: "1" }, items: [] },
      { assignment: { a: "2", b: "2" }, items: [] },
    ]
    const groups = groupByCell(cells)
    expect(groups.size).toBe(2)
    expect(groups.get("a=1; b=2")).toHaveLength(2)
  })
})
