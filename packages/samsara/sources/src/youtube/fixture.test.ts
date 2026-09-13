import { describe, expect, it } from "vitest"
import { readFixture } from "../fixture.js"
import { REDACTED_KEYS } from "./capture.js"
import { createYouTubeAdapter } from "./index.js"
import type { YouTubePayload } from "./types.js"

/**
 * The parser, run against bytes YouTube actually sent.
 *
 * One session from a Singapore egress with a `vi-VN` persona, on 2026-09-13,
 * asking `bánh mì`; 0.497 billed minutes, the most expensive single capture so far
 * and still a rounding error against the ceiling. Everything asserted here is
 * about what came back rather than about what I expected to come back — which is
 * the entire difference between this file and `parse.test.ts`, whose trees I wrote
 * myself and which therefore cannot be wrong about YouTube in a way I am also
 * wrong about.
 *
 * The TikTok adapter got this treatment first, after four failed sessions. This
 * one worked on the first attempt, which is the honest reason YouTube's fixture
 * arrived second: nothing forced the issue.
 */

const DIR = new URL("./__fixtures__", import.meta.url).pathname
const NAME = "youtube-search-vi-VN-2026-09-13"

const capture = readFixture<YouTubePayload>(DIR, NAME)
const items = createYouTubeAdapter("search").parse(capture)

describe("the recorded search capture", () => {
  it("is the session it says it is", () => {
    expect(capture.sourceId).toBe("youtube.search")
    expect(capture.query).toBe("bánh mì")
    expect(capture.payload.surface).toBe("search")
    expect(capture.payload.pageTitle).toBe("bánh mì - YouTube")
    expect(capture.refusedBy).toBeUndefined()
  })

  it("records the URL YouTube ended on, which is not the one we asked for", () => {
    // `buildSearchUrl` sends `gl`, `hl`, `persist_gl` and `persist_hl`. What comes
    // back in `href` has none of them: YouTube consumes the persist pair, stores
    // the preference, and rewrites the address bar. P1.0 measured that the in-page
    // navigation drops `gl`/`hl` and added the persist flags precisely because of
    // it, and this capture is the evidence that the fix works in the only way that
    // matters — the URL is bare and the response is still Vietnamese.
    expect(capture.url).toContain("search_query=")
    expect(capture.url).not.toContain("gl=")
    expect(capture.url).not.toContain("hl=")
  })

  it("was answered in the persona's language", () => {
    // `lượt xem` is "views". It is in the response about a hundred times, in
    // YouTube's own furniture rather than in anything a creator wrote, which is why
    // it is the honest probe: creator text could be Vietnamese on any locale, but
    // the *interface* is Vietnamese only if the viewpoint arrived.
    expect(JSON.stringify(capture)).toContain("lượt xem")
  })
})

describe("what the parser makes of it", () => {
  it("finds the results and not the furniture", () => {
    // Eighteen, from a page that also contains a Shorts shelf, a channel shelf and
    // a topbar full of renderers. The number is pinned in both directions: a name
    // search that starts matching a new renderer returns more, and one that goes
    // stale returns fewer.
    expect(items).toHaveLength(18)
  })

  it("addresses every draft to a real video, once", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/)
    }
    // Deduplication is not theoretical here: this page put videos in a shelf and
    // again in the main list.
    expect(new Set(items.map((item) => item.url)).size).toBe(18)
  })

  it("keeps the text in the language it was written in", () => {
    const vietnamese = items.filter((item) => item.languageGuess === "vi")
    expect(vietnamese.length).toBeGreaterThanOrEqual(12)
    for (const item of items) {
      expect(item.title).not.toBeNull()
      expect(item.text.length).toBeGreaterThan(0)
    }
  })

  it("reads views, and reports likes as unknown rather than zero", () => {
    // A YouTube search result carries a view count and no like count. Every draft
    // here has `views` and every one has `likes: null` — which is the distinction
    // `Engagement` exists to hold. A parser that wrote 0 would be asserting that
    // eighteen videos have no likes, and P1.8 would then average it.
    for (const item of items) {
      expect(item.engagement?.views).toBeGreaterThan(0)
      expect(item.engagement?.likes).toBeNull()
    }
  })

  it("reads a Vietnamese view count as the number it is", () => {
    // 128.395.514 — dot-grouped, which is how Vietnamese writes thousands and how
    // English writes decimals. `parseCount` returning 128 or 128.395 would be a
    // plausible-looking wrong answer that no shape test would catch, and this is
    // the only place in the suite where the grouping comes from the source rather
    // than from me.
    expect(items[0]?.engagement?.views).toBe(128_395_514)
  })

  it("keeps a thumbnail for every draft", () => {
    for (const item of items) {
      expect(item.mediaRefs.length).toBeGreaterThan(0)
    }
  })
})

describe("the bytes that are checked in", () => {
  it("carries no key the redaction list names", () => {
    // Re-audits the committed file against the *current* list, so that adding a key
    // after reading some future capture goes red here until this fixture is brought
    // up to date. See the TikTok twin of this test: the list is on its third
    // revision there, and every revision came from reading a page.
    const found: string[] = []
    const walk = (node: unknown, trail: string) => {
      if (Array.isArray(node)) {
        node.forEach((entry, index) => {
          walk(entry, `${trail}/${index}`)
        })
        return
      }
      if (node === null || typeof node !== "object") return
      for (const [key, value] of Object.entries(node)) {
        if (REDACTED_KEYS.has(key)) found.push(`${trail}/${key}`)
        walk(value, `${trail}/${key}`)
      }
    }
    walk(capture.payload, "payload")

    expect(found).toEqual([])
  })

  it("carries no bearer-shaped string", () => {
    // The TikTok capture held a live Apple Music JWT under a key no list written
    // from TikTok's vocabulary would have contained. This one does not, and the
    // check stays anyway: a denylist cannot find the first instance of anything.
    expect(JSON.stringify(capture)).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/)
  })
})
