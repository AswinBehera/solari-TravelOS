import { describe, expect, it } from "vitest"
import type { Capture } from "../adapter.js"
import { parseTikTok } from "./parse.js"
import type { InterceptedBody, TikTokPayload } from "./types.js"

/**
 * The trees below are **built by hand**. They test what the parser does with a
 * shape, not that the shape is right — only a recorded capture establishes that,
 * and `tiktok.fixture.test.ts` does not exist yet for the same reason its YouTube
 * counterpart does not: recording costs a browser session and publishes bytes.
 *
 * The distinction matters more here than it did for YouTube, because this parser
 * recognises items **structurally** rather than by name. A hand-written tree
 * proves the predicate accepts what I think an item looks like. It cannot prove
 * that is what TikTok sends.
 */

function item(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "7301234567890123456",
    desc: "bánh mì ngon quá",
    author: { uniqueId: "someone", nickname: "Someone" },
    stats: { playCount: 41238, diggCount: 900, commentCount: 12 },
    video: { cover: "https://p16.tiktok.test/cover.jpg" },
    ...over,
  }
}

function capture(payload: Partial<TikTokPayload>): Capture<TikTokPayload> {
  return {
    sourceId: "tiktok.search",
    query: "bánh mì",
    url: "https://www.tiktok.com/search?q=b%C3%A1nh%20m%C3%AC",
    capturedAt: new Date("2026-09-13T00:00:00Z"),
    payload: {
      state: null,
      intercepted: [],
      pageTitle: "",
      surface: "search",
      strategies: { state: false, intercepted: 0 },
      tiles: 0,
      ...payload,
    },
  }
}

function body(path: string, value: unknown): InterceptedBody {
  return { path, body: value }
}

describe("parseTikTok", () => {
  it("reads an item out of the embedded state", () => {
    const drafts = parseTikTok(capture({ state: { ItemModule: { a: item() } } }))
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      url: "https://www.tiktok.com/@someone/video/7301234567890123456",
      title: null,
      text: "bánh mì ngon quá",
      // Not `"vi"`. Every accent in `bánh mì ngon quá` is plain Latin-1 and shared
      // with Spanish; the detector declines rather than claiming. See `language.ts`.
      languageGuess: null,
      engagement: { views: 41238, likes: 900, comments: 12 },
    })
  })

  it("reads items out of an intercepted api body", () => {
    const drafts = parseTikTok(
      capture({
        intercepted: [
          body("/api/search/general/full/", {
            data: [{ type: 1, item: item({ id: "1", desc: "one" }) }],
          }),
        ],
      }),
    )
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.text).toBe("one")
  })

  it("uses both strategies and does not report the same video twice", () => {
    // The case the whole two-strategy design exists for: the page rendered the
    // item *and* the API returned it. One video was on the screen, so one row.
    const drafts = parseTikTok(
      capture({
        state: { ItemModule: { a: item({ id: "1", desc: "from state" }) } },
        intercepted: [body("/api/explore/item_list/", { itemList: [item({ id: "1" })] })],
      }),
    )
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.text).toBe("from state")
  })

  it("keeps encounter order, because encounter order is rank order", () => {
    const drafts = parseTikTok(
      capture({
        state: { ItemModule: { a: item({ id: "1", desc: "first" }) } },
        intercepted: [
          body("/api/explore/item_list/", {
            itemList: [item({ id: "2", desc: "second" }), item({ id: "3", desc: "third" })],
          }),
        ],
      }),
    )
    expect(drafts.map((d) => d.text)).toEqual(["first", "second", "third"])
  })

  it("refuses a hashtag, which has an id and no caption", () => {
    const drafts = parseTikTok(
      capture({
        state: {
          ChallengeModule: { a: { id: "1234", title: "bánhmì", stats: { videoCount: 40 } } },
        },
      }),
    )
    expect(drafts).toEqual([])
  })

  it("refuses a music track, which has a numeric id and a title rather than a caption", () => {
    const drafts = parseTikTok(
      capture({ state: { MusicModule: { a: { id: "7300", title: "a song", authorName: "x" } } } }),
    )
    expect(drafts).toEqual([])
  })

  it("refuses an object whose id is not a digit string", () => {
    const drafts = parseTikTok(capture({ state: { x: item({ id: "food" }) } }))
    expect(drafts).toEqual([])
  })

  it("keeps an item whose caption is empty, which is a real thing", () => {
    // `typeof desc === "string"` rather than truthiness. A video with no caption is
    // a video; dropping it would make the harvest disagree with the page.
    const drafts = parseTikTok(capture({ state: { x: item({ desc: "" }) } }))
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.text).toBe("")
    expect(drafts[0]?.languageGuess).toBeNull()
  })

  it("falls back to the id-only url when the author is unreadable", () => {
    const drafts = parseTikTok(capture({ state: { x: item({ author: { nickname: "x" } }) } }))
    expect(drafts[0]?.url).toBe("https://www.tiktok.com/video/7301234567890123456")
  })

  it("reads abbreviated string counts, which is what the rendered state carries", () => {
    const drafts = parseTikTok(
      capture({
        state: {
          x: {
            id: "7301234567890123456",
            desc: "x",
            statsV2: { playCount: "1.2M", diggCount: "45.6K", commentCount: "0" },
          },
        },
      }),
    )
    expect(drafts[0]?.engagement).toEqual({ views: 1_200_000, likes: 45_600, comments: 0 })
  })

  it("leaves a field null rather than inventing a zero for it", () => {
    const drafts = parseTikTok(capture({ state: { x: item({ stats: { playCount: 10 } }) } }))
    expect(drafts[0]?.engagement).toEqual({ views: 10, likes: null, comments: null })
  })

  it("returns null engagement when the source said nothing at all about it", () => {
    const drafts = parseTikTok(
      capture({ state: { x: { id: "7301", desc: "x", author: { uniqueId: "a" } } } }),
    )
    expect(drafts[0]?.engagement).toBeNull()
  })

  it("declines Vietnamese it cannot prove, and says so as null", () => {
    // The limitation, asserted rather than left to be rediscovered: a caption whose
    // only accents are Latin-1 is indistinguishable from Spanish to a script test.
    const plain = parseTikTok(capture({ state: { x: item({ desc: "bánh mì ngon quá" }) } }))
    expect(plain[0]?.languageGuess).toBeNull()
    // And fires when the caption actually contains a Vietnamese-specific letter.
    const marked = parseTikTok(capture({ state: { x: item({ desc: "quán ăn ngon" }) } }))
    expect(marked[0]?.languageGuess).toBe("vi")
  })

  it("prefers the source's own language claim over the script guess", () => {
    // A caption of hashtags and emoji has no Vietnamese diacritics to detect, which
    // is exactly when the source's claim is worth more than the heuristic.
    const drafts = parseTikTok(
      capture({ state: { x: item({ desc: "#fyp #xuhuong 🔥", textLanguage: "vi-VN" }) } }),
    )
    expect(drafts[0]?.languageGuess).toBe("vi")
  })

  it("collects the covers it was given and nothing it was not", () => {
    const drafts = parseTikTok(
      capture({ state: { x: item({ video: { cover: "a.jpg", originCover: "b.jpg" } }) } }),
    )
    expect(drafts[0]?.mediaRefs).toEqual(["a.jpg", "b.jpg"])
  })

  it("returns nothing for a payload with neither strategy in it", () => {
    expect(parseTikTok(capture({}))).toEqual([])
  })

  it("survives a cyclic payload rather than hanging the runner", () => {
    const cycle: Record<string, unknown> = { id: "7301", desc: "x", stats: {} }
    cycle.self = cycle
    expect(() => parseTikTok(capture({ state: cycle }))).not.toThrow()
  })
})
