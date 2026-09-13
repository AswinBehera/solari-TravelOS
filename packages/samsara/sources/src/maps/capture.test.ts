import { silentLogger } from "@samsara/kernel"
import { describe, expect, it } from "vitest"
import type { CaptureContext } from "../adapter.js"
import {
  buildReviewsUrl,
  buildSearchUrl,
  captureMaps,
  type MapsCaptureOptions,
  type MapsPage,
  type MapsResponse,
  SHAPE_REDACTIONS,
} from "./capture.js"
import { clickMapsTab, expandMapsReviews, type MapsPageRead, scrollMapsPane } from "./inpage.js"

/**
 * A page that was never loaded.
 *
 * `evaluate` dispatches on the **identity** of the function it is handed, which is
 * available here because the test imports the same module `capture.ts` does. That
 * matters more for this adapter than for the other two: `captureMaps` runs four
 * different in-page functions in a particular order, and a fake that ignored which
 * one it was asked for could not tell "clicked the tab, then scrolled" from
 * "scrolled, then never clicked anything".
 *
 * What happens inside those functions against Google's markup is `inpage.test.ts`'s
 * job, and what happens against Google's *real* markup is the fixture's.
 */
function fakePage(
  read: Partial<MapsPageRead> = {},
  options: { href?: string; heights?: number[]; tabAt?: number | null } = {},
) {
  const visited: string[] = []
  const calls: string[] = []
  let handler: ((response: MapsResponse) => void) | null = null
  let scroll = 0

  const page = {
    async goto(url: string) {
      visited.push(url)
      return null
    },
    url: () => options.href ?? visited[visited.length - 1] ?? "",
    async evaluate(fn: unknown, arg?: unknown) {
      if (fn === clickMapsTab) {
        calls.push(`tab:${String(arg)}`)
        return options.tabAt === null ? null : arg
      }
      if (fn === scrollMapsPane) {
        const heights = options.heights ?? [100, 200, 200]
        const height = heights[Math.min(scroll, heights.length - 1)] ?? 0
        scroll += 1
        calls.push(`scroll:${height}`)
        return height
      }
      if (fn === expandMapsReviews) {
        calls.push("expand")
        return 1
      }
      calls.push("read")
      return {
        reviews: [],
        entities: [],
        state: null,
        stateLength: null,
        stateKeys: [],
        tabLabels: [],
        nodeCounts: {},
        wall: null,
        title: "Google Maps",
        href: options.href ?? visited[visited.length - 1] ?? "",
        ...read,
      }
    },
    on(_event: "response", fn: (response: MapsResponse) => void) {
      handler = fn
    },
    off() {
      handler = null
    },
    async waitForTimeout() {},
  }

  const respond = (url: string) => {
    handler?.({ url: () => url, status: () => 200 })
  }
  return { page: page as unknown as MapsPage, visited, calls, respond }
}

const PERSONA = { id: "p1", country: "sg", locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" }

function ctx(page: MapsPage): CaptureContext {
  return { page, persona: PERSONA, logger: silentLogger, signal: new AbortController().signal }
}

/** No settle anywhere in this file: a test must not sit on a clock. */
const FAST: MapsCaptureOptions = { settleMs: 0 }

const ENTITY = "https://www.google.com/maps/@10.77,106.69,17z/data=!4m6!3m5!1s0x31752f3e:0xb2a1c9"

describe("the url", () => {
  it("asks in the persona's language and claims its region", () => {
    const url = new URL(buildSearchUrl("bánh mì", PERSONA))
    expect(url.pathname).toContain(encodeURIComponent("bánh mì"))
    // A language, not a locale — the same narrowing YouTube needs.
    expect(url.searchParams.get("hl")).toBe("vi")
    expect(url.searchParams.get("gl")).toBe("sg")
  })

  it("takes the reviews address as data and adds the viewpoint to it", () => {
    const url = new URL(buildReviewsUrl(ENTITY, PERSONA))
    expect(url.pathname).toContain("!1s0x31752f3e:0xb2a1c9")
    expect(url.searchParams.get("hl")).toBe("vi")
  })

  it("refuses to navigate anywhere that is not Google", () => {
    // The reviews surface navigates to its query, which arrives from a previous
    // capture. An adapter that will go anywhere on request is a proxy with this
    // project's egress address on it, and the query is the one field a caller
    // controls completely.
    expect(() => buildReviewsUrl("https://example.com/maps/x", PERSONA)).toThrow(/Google/)
    expect(() => buildReviewsUrl("http://www.google.com/maps/x", PERSONA)).toThrow(/Google/)
    expect(() => buildReviewsUrl("https://notgoogle.com/", PERSONA)).toThrow(/Google/)
    expect(() => buildReviewsUrl("https://www.google.co.uk/maps/x", PERSONA)).not.toThrow()
  })
})

describe("what the capture records", () => {
  it("stores the question, the surface and the address it ended on", async () => {
    const { page } = fakePage({ state: "[]", entities: [], href: "https://www.google.com/maps/x" })
    const capture = await captureMaps(ctx(page), "quán ăn quận 1", "search", FAST)
    expect(capture.sourceId).toBe("maps.search")
    expect(capture.query).toBe("quán ăn quận 1")
    expect(capture.payload.surface).toBe("search")
    expect(capture.url).toBe("https://www.google.com/maps/x")
  })

  it("opens the tab before it scrolls, and expands after", async () => {
    const { page, calls } = fakePage({ tabLabels: ["a", "b", "c"] })
    await captureMaps(ctx(page), ENTITY, "reviews", FAST)
    expect(calls[0]).toBe("tab:1")
    expect(calls.filter((c) => c.startsWith("scroll")).length).toBeGreaterThan(0)
    expect(calls.indexOf("expand")).toBeGreaterThan(calls.lastIndexOf("scroll:200"))
    expect(calls[calls.length - 1]).toBe("read")
  })

  it("does not touch the tab strip on the search surface", async () => {
    const { page, calls } = fakePage({ state: "[]" })
    await captureMaps(ctx(page), "q", "search", FAST)
    expect(calls.some((c) => c.startsWith("tab:"))).toBe(false)
    expect(calls).not.toContain("expand")
  })

  it("stops scrolling when the pane stops growing", async () => {
    // Every round is billed. A round that buys nothing costs exactly as much as one
    // that does, which is why the loop watches the height rather than the counter.
    const { page } = fakePage({ state: "[]" }, { heights: [100, 200, 200, 300] })
    const capture = await captureMaps(ctx(page), "q", "search", FAST)
    expect(capture.payload.scrolls).toBe(3)
  })

  it("never scrolls past the cap, however much the pane grows", async () => {
    const { page } = fakePage({ state: "[]" }, { heights: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] })
    const capture = await captureMaps(ctx(page), "q", "search", { settleMs: 0, maxScrolls: 4 })
    expect(capture.payload.scrolls).toBe(4)
  })

  it("keeps the paths the page asked for, without their query strings", async () => {
    const { page, respond } = fakePage({ state: "[]" })
    const capture = captureMaps(ctx(page), "q", "search", FAST)
    respond("https://www.google.com/maps/rpc/listugcposts?authuser=0&pb=!1m2")
    respond("https://www.google.com/maps/rpc/listugcposts?authuser=0&pb=!9z9")
    respond("https://www.google.com/search?tbm=map&q=secret")
    const result = await capture
    expect(result.payload.observedPaths).toEqual(["/maps/rpc/listugcposts", "/search"])
    expect(JSON.stringify(result.payload.observedPaths)).not.toContain("secret")
  })

  it("carries the three diagnostics that would otherwise cost a session each", async () => {
    // Which tab is the reviews tab, whether `data-review-id` still anchors a review,
    // and whether the blob is still called what it was called. One capture answers
    // all three — including a capture that failed.
    const { page } = fakePage({
      tabLabels: ["Tổng quan", "Bài đánh giá"],
      nodeCounts: { "[data-review-id]": 0, "span.wiI7pd": 0 },
      stateKeys: ["APP_INITIALIZATION_STATE"],
      state: "[1]",
      stateLength: 940_112,
    })
    const capture = await captureMaps(ctx(page), ENTITY, "reviews", FAST)
    expect(capture.payload.tabLabels).toEqual(["Tổng quan", "Bài đánh giá"])
    expect(capture.payload.tabOpened).toBe(1)
    expect(capture.payload.nodeCounts["[data-review-id]"]).toBe(0)
    expect(capture.payload.stateKeys).toEqual(["APP_INITIALIZATION_STATE"])
    // The blob is stored truncated and says what it was truncated from.
    expect(capture.payload.stateLength).toBe(940_112)
  })
})

describe("redaction by shape", () => {
  const JWT = "eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJzb21lb25lIiwiZXhwIjo5OTk5fQ.c2lnbmF0dXJlLWJ5dGVz"

  it("removes a credential shape from the blob nobody reads", async () => {
    const { page } = fakePage({
      state: `[["config","AIzaSyA1234567890123456789012345678901234"],["${JWT}"]]`,
    })
    const capture = await captureMaps(ctx(page), "q", "search", FAST)
    expect(capture.payload.state).not.toContain("AIzaSy")
    expect(capture.payload.state).not.toContain("eyJhbGciOiJFUzI1NiJ9")
    expect(capture.payload.state).toContain("[redacted-key]")
    expect(capture.payload.state).toContain("[redacted-jwt]")
    // The rest of the blob is untouched: this is redaction, not narrowing.
    expect(capture.payload.state).toContain("config")
  })

  it("scrubs a review's text without touching the sentence", async () => {
    const { page } = fakePage({
      reviews: [
        {
          reviewId: "r1",
          authorName: "Ngọc Anh",
          authorHref: null,
          authorMeta: null,
          ratingLabel: "5 sao",
          relativeTime: "2 tháng trước",
          text: `Bánh mì ngon quá ${JWT}`,
          photoRefs: [],
          helpfulLabel: null,
          ownerReply: null,
        },
      ],
      state: "[]",
      tabLabels: ["a", "b"],
    })
    const capture = await captureMaps(ctx(page), ENTITY, "reviews", FAST)
    expect(capture.payload.reviews[0]?.text).toBe("Bánh mì ngon quá [redacted-jwt]")
    expect(capture.payload.reviews[0]?.authorName).toBe("Ngọc Anh")
  })

  it("is greedy on purpose, because nothing reads what it redacts", () => {
    // Over-redaction is free here and was not free for TikTok, where the same
    // instrument ate an author's bio. The difference is whether the field is read.
    expect(SHAPE_REDACTIONS.length).toBeGreaterThan(0)
    for (const [pattern] of SHAPE_REDACTIONS) expect(pattern.flags).toContain("g")
  })
})

describe("what counts as a refusal", () => {
  it("names the wall rather than reporting that there was one", async () => {
    for (const [wall, expected] of [
      ["captcha", "captcha"],
      ["consent", "consent-wall"],
    ] as const) {
      const { page } = fakePage({ wall, state: "[]" })
      const capture = await captureMaps(ctx(page), "q", "search", FAST)
      expect(capture.refusedBy).toBe(expected)
    }
  })

  it("reports being sent somewhere else", async () => {
    const { page } = fakePage(
      { href: "https://elsewhere.example/x" },
      { href: "https://elsewhere.example/x" },
    )
    const capture = await captureMaps(ctx(page), "q", "search", FAST)
    expect(capture.refusedBy).toContain("elsewhere.example")
  })

  it("treats no tab strip as not having reached the entity at all", async () => {
    const { page } = fakePage({ state: "[]" }, { tabAt: null })
    const capture = await captureMaps(ctx(page), ENTITY, "reviews", FAST)
    expect(capture.refusedBy).toContain("no tab strip")
  })

  it("notices a reviews capture that is still on the result list", async () => {
    const { page } = fakePage({
      state: "[]",
      tabLabels: ["a", "b"],
      entities: [
        { href: ENTITY, name: "x", ratingLabel: null, reviewCountLabel: null, detailLines: [] },
      ],
    })
    const capture = await captureMaps(ctx(page), ENTITY, "reviews", FAST)
    expect(capture.refusedBy).toContain("still on the result list")
  })

  it("does not call an honest zero a refusal", async () => {
    // The orchestrator has an `empty` outcome. Folding a quiet area or an entity
    // nobody has written about into `blocked` would degrade a persona over a typo
    // and make a real block indistinguishable from a real absence.
    const quiet = fakePage({ state: "[[]]", entities: [] })
    expect((await captureMaps(ctx(quiet.page), "q", "search", FAST)).refusedBy).toBeUndefined()

    const unloved = fakePage({ state: "[[]]", reviews: [], tabLabels: ["a", "b"] })
    expect(
      (await captureMaps(ctx(unloved.page), ENTITY, "reviews", FAST)).refusedBy,
    ).toBeUndefined()
  })

  it("does call a page it could not read at all a refusal", async () => {
    // No result card and no blob is not "Google has nothing about this"; it is "we
    // cannot read what Google sent", which is a different row and a different fix.
    const { page } = fakePage({ state: null, entities: [] })
    const capture = await captureMaps(ctx(page), "q", "search", FAST)
    expect(capture.refusedBy).toContain("no result card and no state")
  })
})
