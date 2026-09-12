import { describe, expect, it } from "vitest"
import { cellCount, cellKey, differingFactors, expand, shuffle } from "./matrix.js"

describe("expanding a factorial design", () => {
  it("produces every combination", () => {
    const cells = expand({ egress: ["sg", "us"], locale: ["th-TH", "en-US"] })
    expect(cells).toHaveLength(4)
    expect(new Set(cells.map(cellKey))).toEqual(
      new Set([
        "egress=sg; locale=th-TH",
        "egress=sg; locale=en-US",
        "egress=us; locale=th-TH",
        "egress=us; locale=en-US",
      ]),
    )
  })

  it("orders cells the same way twice, so cell 7 means one thing across runs", () => {
    const factors = { b: ["1", "2"], a: ["x", "y"], c: ["p", "q"] }
    expect(expand(factors).map(cellKey)).toEqual(expand(factors).map(cellKey))
    // Names sorted, last varying fastest.
    expect(expand(factors).slice(0, 2).map(cellKey)).toEqual(["a=x; b=1; c=p", "a=x; b=1; c=q"])
  })

  it("counts cells without building them", () => {
    const factors = { a: ["1", "2"], b: ["1", "2", "3"], c: ["1", "2"] }
    expect(cellCount(factors)).toBe(12)
    expect(expand(factors)).toHaveLength(12)
  })

  it("refuses an empty axis rather than silently designing no experiment", () => {
    expect(() => expand({ egress: ["sg"], locale: [] })).toThrow(/locale/)
  })

  it("treats no factors as one cell, not none", () => {
    expect(expand({})).toEqual([{}])
    expect(cellCount({})).toBe(1)
  })

  it("keys are insertion-order independent", () => {
    expect(cellKey({ b: "2", a: "1" })).toBe(cellKey({ a: "1", b: "2" }))
  })

  it("names the factors two cells disagree on", () => {
    const a = { egress: "sg", locale: "th-TH", stored: "set" }
    const b = { egress: "us", locale: "th-TH", stored: "unset" }
    expect(differingFactors(a, b)).toEqual(["egress", "stored"])
    expect(differingFactors(a, a)).toEqual([])
  })
})

describe("shuffling a run order", () => {
  it("is a permutation, not a filter", () => {
    const cells = expand({ a: ["1", "2"], b: ["1", "2"], c: ["1", "2"], d: ["1", "2"] })
    const order = shuffle(cells, 1)
    expect(order).toHaveLength(cells.length)
    expect(new Set(order.map(cellKey))).toEqual(new Set(cells.map(cellKey)))
  })

  it("replays exactly from the same seed, and differs from another", () => {
    const cells = expand({ a: ["1", "2", "3"], b: ["1", "2", "3"] })
    expect(shuffle(cells, 7).map(cellKey)).toEqual(shuffle(cells, 7).map(cellKey))
    expect(shuffle(cells, 7).map(cellKey)).not.toEqual(shuffle(cells, 8).map(cellKey))
  })

  it("leaves the input alone", () => {
    const cells = expand({ a: ["1", "2"] })
    const before = cells.map(cellKey)
    shuffle(cells, 3)
    expect(cells.map(cellKey)).toEqual(before)
  })
})
