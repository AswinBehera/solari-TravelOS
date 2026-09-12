import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { silentLogger } from "@samsara/kernel"
import { afterAll, describe, expect, it, vi } from "vitest"
import type { Capture, CaptureContext, ItemDraft, SourceAdapter } from "./adapter.js"
import { harvest } from "./adapter.js"
import { readFixture, writeFixture } from "./fixture.js"

/**
 * The adapter contract, exercised through a source that returns fixed bytes.
 *
 * There is no real adapter in this package yet — P1.3 and P1.4 bring the first two
 * — so what is under test here is the shape itself: that parsing is separable from
 * fetching, that a refusal survives, and that the same capture parses the same way
 * twice. Those are the three properties every adapter will inherit, which makes
 * them worth pinning before there is an adapter to argue about.
 */

interface Payload {
  entries: { href: string; title: string; body: string; views: number | null }[]
}

const capturedAt = new Date("2026-09-12T10:00:00.000Z")

const fakeSource: SourceAdapter<Payload> = {
  id: "fake.search",

  async capture(ctx, query): Promise<Capture<Payload>> {
    const page = ctx.page as { read(q: string): Promise<Payload & { walled?: string }> }
    const read = await page.read(query)
    return {
      sourceId: "fake.search",
      query,
      url: `https://fake.test/search?q=${encodeURIComponent(query)}`,
      capturedAt,
      payload: { entries: read.entries },
      ...(read.walled ? { refusedBy: read.walled } : {}),
    }
  },

  parse(capture): readonly ItemDraft[] {
    return capture.payload.entries.map((e) => ({
      url: e.href,
      title: e.title,
      text: e.body,
      languageGuess: null,
      mediaRefs: [],
      engagement: e.views === null ? null : { views: e.views, likes: null, comments: null },
    }))
  },
}

const ctxWith = (read: () => Promise<Payload & { walled?: string }>): CaptureContext => ({
  page: { read },
  persona: { id: "p1", country: "sg", locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" },
  logger: silentLogger,
  signal: new AbortController().signal,
})

const twoEntries: Payload = {
  entries: [
    { href: "https://fake.test/a", title: "A", body: "first", views: 10 },
    { href: "https://fake.test/b", title: "B", body: "second", views: null },
  ],
}

describe("the adapter contract", () => {
  it("returns what the source said, in the source's own order", async () => {
    const out = await harvest(
      fakeSource,
      ctxWith(async () => twoEntries),
      "xin chào",
    )
    expect(out.items.map((i) => i.url)).toEqual(["https://fake.test/a", "https://fake.test/b"])
    expect(out.capture.query).toBe("xin chào")
  })

  it("keeps zero and unknown engagement apart", async () => {
    const payload: Payload = {
      entries: [
        { href: "https://fake.test/zero", title: "Z", body: "", views: 0 },
        { href: "https://fake.test/unknown", title: "U", body: "", views: null },
      ],
    }
    const out = await harvest(
      fakeSource,
      ctxWith(async () => payload),
      "q",
    )
    // A source reporting zero views and a source not reporting views at all are
    // different facts. Collapsing them makes every unmeasured item look unpopular.
    expect(out.items[0]?.engagement).toEqual({ views: 0, likes: null, comments: null })
    expect(out.items[1]?.engagement).toBeNull()
  })

  it("carries a refusal instead of throwing it", async () => {
    const out = await harvest(
      fakeSource,
      ctxWith(async () => ({ entries: [], walled: "consent" })),
      "q",
    )
    expect(out.capture.refusedBy).toBe("consent")
  })

  it("does not parse a refused capture", async () => {
    const parse = vi.spyOn(fakeSource, "parse")
    await harvest(
      fakeSource,
      ctxWith(async () => ({
        entries: [{ href: "x", title: "x", body: "x", views: 1 }],
        walled: "captcha",
      })),
      "q",
    )
    // A parser run over a consent wall returns zero items, and zero items from a
    // refusal is indistinguishable from zero items from an honest empty result.
    expect(parse).not.toHaveBeenCalled()
    parse.mockRestore()
  })

  it("parses without a browser, a clock or a network", () => {
    const capture: Capture<Payload> = {
      sourceId: "fake.search",
      query: "q",
      url: "https://fake.test/search?q=q",
      capturedAt,
      payload: twoEntries,
    }
    // No context, no page, no await. This is the property the whole split exists
    // for: iterating a parser costs nothing.
    expect(fakeSource.parse(capture)).toHaveLength(2)
  })

  it("is pure: the same capture parses identically twice", () => {
    const capture: Capture<Payload> = {
      sourceId: "fake.search",
      query: "q",
      url: "https://fake.test/",
      capturedAt,
      payload: twoEntries,
    }
    expect(fakeSource.parse(capture)).toEqual(fakeSource.parse(capture))
  })
})

describe("fixtures", () => {
  const dir = mkdtempSync(join(tmpdir(), "samsara-fixture-"))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it("survives a write and a read with capturedAt still a Date", () => {
    const capture: Capture<Payload> = {
      sourceId: "fake.search",
      query: "xin chào thế giới",
      url: "https://fake.test/",
      capturedAt,
      payload: twoEntries,
      refusedBy: "consent",
    }
    writeFixture(dir, "sample", capture)
    const back = readFixture<Payload>(dir, "sample")

    expect(back.capturedAt).toBeInstanceOf(Date)
    expect(back.capturedAt.toISOString()).toBe(capturedAt.toISOString())
    expect(back).toEqual(capture)
    // Non-ASCII queries are the normal case here, not an edge case: P1.0 measured
    // the query language to be the dominant signal.
    expect(back.query).toBe("xin chào thế giới")
  })

  it("parses from a file exactly as it parses from memory", () => {
    const capture: Capture<Payload> = {
      sourceId: "fake.search",
      query: "q",
      url: "https://fake.test/",
      capturedAt,
      payload: twoEntries,
    }
    writeFixture(dir, "parity", capture)
    expect(fakeSource.parse(readFixture<Payload>(dir, "parity"))).toEqual(fakeSource.parse(capture))
  })

  it("fails loudly on a missing fixture rather than parsing nothing", () => {
    // A renamed fixture must fail, not quietly assert that a parser produces no
    // items — which it does, correctly, when handed nothing.
    expect(() => readFixture(dir, "never-recorded")).toThrow(/no fixture at/)
  })
})
