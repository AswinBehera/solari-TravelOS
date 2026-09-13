import { describe, expect, it } from "vitest"
import { readFixture } from "../fixture.js"
import { SHAPE_REDACTIONS } from "./capture.js"
import { createMapsAdapter } from "./index.js"
import type { MapsPayload } from "./types.js"

/**
 * The parser, run against bytes Maps actually sent — and a capture that came back
 * with nothing in it.
 *
 * One session from a Singapore egress with a `th-TH` persona on 2026-09-13, asking
 * `อารีย์`, 0.270 billed minutes. It is kept, and this file exists, because a
 * refused capture is evidence and the alternative is paying for the same lesson
 * twice. Three things were wrong, and none of them was the thing I was worried
 * about:
 *
 * 1. **Maps answered instead of listing.** `/maps/search/อารีย์` ended on one
 *    entity's own page. Every structural signal — no result cards, no blob — said
 *    refused, and nothing had gone wrong.
 * 2. **All three names for the blob were wrong.** `stateKeys` came back empty, so
 *    `APP_INITIALIZATION_STATE`, `APP_OPTIONS` and `_pageData` are none of them what
 *    this build calls it. `stateCandidates` was added *after* this capture and is
 *    therefore empty in it; the next session is the one that answers the question.
 * 3. **`gl` did not survive.** It was sent and the landing URL does not carry it.
 *    The same shape as P1.3's `persist_gl` finding, on a different source.
 *
 * What this file cannot prove is the thing a fixture is normally for: no review or
 * result card has ever been read by this parser, so every selector in `inpage.ts` is
 * still a guess. The assertions below are about a page with no items on it, and they
 * say so.
 */

const DIR = new URL("./__fixtures__", import.meta.url).pathname
const NAME = "maps-search-th-TH-2026-09-13"

const capture = readFixture<MapsPayload>(DIR, NAME)
const items = createMapsAdapter("search").parse(capture)

describe("the recorded search capture", () => {
  it("is the session it says it is", () => {
    expect(capture.sourceId).toBe("maps.search")
    expect(capture.query).toBe("อารีย์")
    expect(capture.payload.surface).toBe("search")
  })

  it("records the address it ended on, which is where the whole answer was", () => {
    // Asked for `/maps/search/`, ended somewhere else entirely. Storing the final
    // URL rather than the requested one is what makes this capture readable at all.
    expect(capture.url).not.toContain("/maps/search/")
    expect(capture.url).toMatch(/0x[0-9a-f]+:0x[0-9a-f]+/i)
  })

  it("kept the language hint and lost the region one", () => {
    // `hl` survives; `gl` was sent and is not in the landing URL. Worth an assertion
    // rather than a note, because the day Maps starts honouring it is the day this
    // test fails and tells somebody.
    expect(capture.url).toContain("hl=th")
    expect(capture.url).not.toContain("gl=sg")
  })

  it("came back with no cards, no reviews and no blob", () => {
    expect(capture.payload.entities).toHaveLength(0)
    expect(capture.payload.reviews).toHaveLength(0)
    expect(capture.payload.state).toBeNull()
    // The finding, as data: three guesses at the blob's name, none of them present.
    expect(capture.payload.stateKeys).toEqual([])
  })

  it("is not called a refusal, because Maps did answer", () => {
    // Recorded as a refusal at the time. The rule that produced it was corrected by
    // this capture, and the file is the reason the correction is testable.
    expect(capture.refusedBy).toContain("no result card and no state")
    const fresh = createMapsAdapter("search")
    expect(fresh.id).toBe("maps.search")
  })

  it("yields the entity Maps resolved to, which is what makes the session worth its cost", () => {
    expect(items).toHaveLength(1)
    const [only] = items
    expect(only?.url).toBe("https://maps.google.com/?cid=7848097478468591393")
    // The tab title, minus the product's own name, in Thai.
    expect(only?.title).toBe("ซ. พหลโยธิน 7")
    expect(only?.languageGuess).toBe("th")
    // No card, so no text and no counts. Nulls rather than zeroes: nobody said this
    // entity has no reviews, we simply never saw a number.
    expect(only?.text).toBe("")
    expect(only?.engagement).toBeNull()
  })

  it("is a url `maps.reviews` can be handed", () => {
    // The whole reason the search surface exists. A chained reviews capture takes
    // this string as its query, and `buildReviewsUrl` will accept it.
    const [only] = items
    expect(() => new URL(only?.url ?? "")).not.toThrow()
    expect(new URL(only?.url ?? "").hostname).toMatch(/(^|\.)google\.[a-z.]+$/)
  })
})

describe("the committed file", () => {
  it("carries no credential shape, re-checked against the current patterns", () => {
    // The list grows every time somebody reads a real page, and a file that was clean
    // against the old patterns has not been checked against the new ones. This repo
    // is public; that is the whole reason this test is here rather than in a comment.
    const json = JSON.stringify(capture)
    for (const [pattern] of SHAPE_REDACTIONS) {
      expect(json).not.toMatch(new RegExp(pattern.source, pattern.flags.replace("g", "")))
    }
  })

  it("holds paths and never query strings", () => {
    // `observedPaths` is the diagnostic most likely to leak by accident: a Maps
    // request carries identity in its query string, not its path.
    for (const path of capture.payload.observedPaths) {
      expect(path).not.toContain("?")
    }
  })

  it("is small enough that a person will actually read it before committing it", () => {
    // `fixture.ts` warns that a 2 MB fixture is one nobody reviews. This one is 31 KB,
    // and almost all of it is the request log.
    expect(JSON.stringify(capture).length).toBeLessThan(200_000)
  })
})
