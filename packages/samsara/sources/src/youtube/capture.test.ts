import { silentLogger } from "@samsara/kernel"
import { describe, expect, it } from "vitest"
import type { CaptureContext } from "../adapter.js"
import { buildSearchUrl, buildTrendingUrl, captureYouTube, type YouTubePage } from "./capture.js"
import type { PageRead } from "./inpage.js"

/**
 * A page that was never loaded.
 *
 * `evaluate` ignores the function it is handed and returns a canned read, which is
 * the honest limit of this harness: it exercises everything `captureYouTube` does
 * with the result, and nothing about whether the in-page function finds
 * `ytInitialData` on a real document. That second thing is only testable against a
 * real page, and is what the recorded fixture is for.
 */
function fakePage(read: Partial<PageRead>, options: { href?: string } = {}) {
  const visited: string[] = []
  const page: YouTubePage = {
    async goto(url) {
      visited.push(url)
      return null
    },
    url: () => options.href ?? visited[visited.length - 1] ?? "",
    async evaluate<R>(): Promise<R> {
      return {
        data: null,
        walled: false,
        title: "YouTube",
        href: options.href ?? visited[visited.length - 1] ?? "",
        ...read,
      } as R
    },
  }
  return { page, visited }
}

const PERSONA = { id: "p1", country: "sg", locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" }

function ctx(page: YouTubePage): CaptureContext {
  return { page, persona: PERSONA, logger: silentLogger, signal: new AbortController().signal }
}

describe("the url", () => {
  it("asks in the persona's language and claims its region", () => {
    const url = new URL(buildSearchUrl("xin chào", PERSONA))
    expect(url.searchParams.get("search_query")).toBe("xin chào")
    expect(url.searchParams.get("gl")).toBe("SG")
    // `hl` is a language, not a locale: YouTube ignores `vi-VN` and honours `vi`.
    expect(url.searchParams.get("hl")).toBe("vi")
  })

  it("persists the hint past the first render", () => {
    // Measured in P1.0: without these, the parameter applies to one paint and is
    // dropped on the in-page navigation that follows, which would have made a whole
    // axis of that experiment report a clean and false zero.
    const url = new URL(buildSearchUrl("q", PERSONA))
    expect(url.searchParams.get("persist_gl")).toBe("1")
    expect(url.searchParams.get("persist_hl")).toBe("1")
  })

  it("builds a trending url with no query on it", () => {
    const url = new URL(buildTrendingUrl(PERSONA))
    expect(url.pathname).toBe("/feed/trending")
    expect(url.searchParams.get("search_query")).toBeNull()
    expect(url.searchParams.get("gl")).toBe("SG")
  })
})

describe("captureYouTube", () => {
  it("stores the question, the url and the surface", async () => {
    const { page, visited } = fakePage({ data: { contents: {} } })
    const capture = await captureYouTube(ctx(page), "xin chào", "search")
    expect(capture.sourceId).toBe("youtube.search")
    expect(capture.query).toBe("xin chào")
    expect(capture.payload.surface).toBe("search")
    expect(visited[0]).toContain("search_query=xin+ch%C3%A0o")
    expect(capture.refusedBy).toBeUndefined()
  })

  it("records the url it ended on, not the one it asked for", async () => {
    // A consent bounce is only visible in the difference between those two.
    const { page } = fakePage(
      { data: { contents: {} }, href: "https://consent.youtube.com/m?continue=x" },
      { href: "https://consent.youtube.com/m?continue=x" },
    )
    const capture = await captureYouTube(ctx(page), "q", "search")
    expect(capture.url).toBe("https://consent.youtube.com/m?continue=x")
  })

  it("carries a consent wall instead of throwing it", async () => {
    const { page } = fakePage({ walled: true, data: { contents: {} } })
    const capture = await captureYouTube(ctx(page), "q", "search")
    expect(capture.refusedBy).toBe("consent-or-captcha")
    // The bytes are kept. They are the evidence that the refusal happened, and the
    // only thing that will explain it in three weeks.
    expect(capture.payload.initialData).toEqual({ contents: {} })
  })

  it("treats a missing ytInitialData as a refusal, with the title as evidence", async () => {
    const { page } = fakePage({ data: null, title: "Before you continue to YouTube" })
    const capture = await captureYouTube(ctx(page), "q", "search")
    expect(capture.refusedBy).toContain("no ytInitialData")
    expect(capture.refusedBy).toContain("Before you continue")
  })

  it("notices a redirect off the host entirely", async () => {
    const { page } = fakePage({ data: { a: 1 }, href: "https://www.google.com/sorry/index" })
    const capture = await captureYouTube(ctx(page), "q", "search")
    expect(capture.refusedBy).toBe("redirected to www.google.com")
  })

  it("does not call an empty result a refusal", async () => {
    // An honest zero. The orchestrator has an `empty` outcome for exactly this, and
    // folding it into `blocked` would degrade a persona's health over a typo — and
    // make a region block indistinguishable from one.
    const { page } = fakePage({ data: { contents: { sectionListRenderer: { contents: [] } } } })
    const capture = await captureYouTube(ctx(page), "asdkjhaskdjh", "search")
    expect(capture.refusedBy).toBeUndefined()
  })

  it("strips the tracking keys at every depth", async () => {
    const { page } = fakePage({
      data: {
        responseContext: {
          visitorData: "Cgt4WU",
          serviceTrackingParams: [{ service: "GFEEDBACK" }],
        },
        trackingParams: "top-level",
        contents: {
          items: [
            {
              videoRenderer: {
                videoId: "aaaaaaaaaaa",
                trackingParams: "nested",
                clickTrackingParams: "deeper",
              },
            },
          ],
        },
      },
    })
    const capture = await captureYouTube(ctx(page), "q", "search")
    const json = JSON.stringify(capture.payload.initialData)
    // This repository is public and this payload goes into a checked-in fixture.
    expect(json).not.toContain("visitorData")
    expect(json).not.toContain("trackingParams")
    expect(json).not.toContain("Cgt4WU")
    // And everything the parser reads is still there.
    expect(json).toContain("aaaaaaaaaaa")
  })

  it("keeps the structure the parser searches, rather than the subtree it happens to want", async () => {
    // The line between redaction and parsing. If this function ever started
    // returning only `contents.twoColumnSearchResultsRenderer`, a YouTube layout
    // change would need a new browser session instead of a new parser — and the
    // reason this package is split in half would be gone.
    const { page } = fakePage({
      data: { contents: { twoColumn: { x: 1 } }, header: { y: 2 }, estimatedResults: "451000" },
    })
    const capture = await captureYouTube(ctx(page), "q", "search")
    expect(capture.payload.initialData).toEqual({
      contents: { twoColumn: { x: 1 } },
      header: { y: 2 },
      estimatedResults: "451000",
    })
  })

  it("stamps capturedAt from the clock, since it is a fact about the request", async () => {
    const { page } = fakePage({ data: {} })
    const before = Date.now()
    const capture = await captureYouTube(ctx(page), "q", "trending")
    expect(capture.capturedAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(capture.sourceId).toBe("youtube.trending")
  })
})
