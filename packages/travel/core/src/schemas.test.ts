import { describe, expect, it } from "vitest"
import * as fx from "./fixtures.js"
import { place, postcard, trip, tripDocument, user } from "./index.js"

describe("every travel schema parses its fixture", () => {
  const cases = [
    ["user", user, fx.userFixture],
    ["trip", trip, fx.tripFixture],
    ["tripDocument", tripDocument, fx.tripDocumentFixture],
    ["place", place, fx.placeFixture],
    ["postcard", postcard, fx.postcardFixture],
  ] as const

  for (const [name, schema, fixture] of cases) {
    it(name, () => {
      expect(schema.parse(fixture)).toMatchObject(fixture as object)
    })
  }
})

describe("the pack's scores are a generic ScoreSet the engine cannot read", () => {
  it("carries an explanation for every score, so the UI can show the algorithm", () => {
    const parsed = place.parse(fx.placeFixture)
    for (const [name, score] of Object.entries(parsed.scores)) {
      expect(score.because.length, `${name} asserts a number with no reasons`).toBeGreaterThan(0)
    }
  })

  it("points every explanation at real Evidence ids", () => {
    const parsed = place.parse(fx.placeFixture)
    const ids = Object.values(parsed.scores).flatMap((s) => s.because.flatMap((b) => b.evidenceIds))
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every((i) => /^[0-9a-f-]{36}$/.test(i))).toBe(true)
  })

  it("lets a Postcard exist without geo — it just will not appear on the map", () => {
    const noGeo = postcard.parse({ ...fx.postcardFixture, kind: "note", placeId: null, geo: null })
    expect(noGeo.geo).toBeNull()
  })
})
