import {
  type BrowserHandle,
  type BrowserLauncher,
  BudgetGuard,
  DEFAULT_CEILINGS,
  Kernel,
  MemoryCounterStore,
  MemoryLogger,
  MemorySessionStore,
  SessionRegistry,
} from "@samsara/kernel"
import type { Capture, CaptureContext, ItemDraft, SourceAdapter } from "@samsara/sources"
import { describe, expect, it } from "vitest"
import { immediatePacer, MemoryPacer } from "./pace.js"
import { runHarvest } from "./run.js"
import {
  type CaptureArchive,
  MemoryCaptureArchive,
  MemoryHarvestRunStore,
  MemoryRawItemStore,
} from "./store.js"

/**
 * The orchestration, with a browser that never existed.
 *
 * What is under test is almost entirely *ordering*: bytes archived before they are
 * parsed, items written before a run is called `ok`, the run finished on every
 * path, and the persona told what the source thought of it. None of those show up
 * as a wrong value — they show up as a run that says `ok` and has nothing behind
 * it — so each one is asserted against the recorded sequence rather than the
 * final state.
 */

interface Payload {
  entries: { href: string; title: string }[]
}

function fakeLauncher(behaviour: { failFirst?: string; failAlways?: string } = {}) {
  let launches = 0
  const launcher: BrowserLauncher = {
    async launch(): Promise<BrowserHandle> {
      launches += 1
      if (behaviour.failAlways) throw new Error(behaviour.failAlways)
      if (behaviour.failFirst && launches === 1) throw new Error(behaviour.failFirst)
      return {
        id: `fake-${launches}`,
        async newPage() {
          return { marker: "page" }
        },
        async close() {},
      }
    },
    async dispose() {},
  }
  return {
    launcher,
    get launches() {
      return launches
    },
  }
}

const capturedAt = new Date("2026-09-12T10:00:00.000Z")

function fakeAdapter(
  behaviour: {
    refusedBy?: string
    entries?: { href: string; title: string }[]
    throwOnParse?: boolean
  } = {},
): SourceAdapter<Payload> & { parsed: number } {
  const adapter = {
    id: "fake.search",
    parsed: 0,
    async capture(ctx: CaptureContext, query: string): Promise<Capture<Payload>> {
      // Proves the kernel really handed a page through, rather than the adapter
      // quietly working without one.
      expect(ctx.page).toEqual({ marker: "page" })
      return {
        sourceId: "fake.search",
        query,
        url: "https://fake.test/search",
        capturedAt,
        payload: { entries: behaviour.entries ?? [{ href: "https://fake.test/a", title: "A" }] },
        ...(behaviour.refusedBy ? { refusedBy: behaviour.refusedBy } : {}),
      }
    },
    parse(capture: Capture<Payload>): readonly ItemDraft[] {
      adapter.parsed += 1
      if (behaviour.throwOnParse) throw new Error("markup changed overnight")
      return capture.payload.entries.map((e) => ({
        url: e.href,
        title: e.title,
        text: e.title,
        languageGuess: null,
        mediaRefs: [],
        engagement: null,
      }))
    },
  }
  return adapter
}

const PERSONA = {
  id: "11111111-1111-4111-8111-111111111111",
  country: "sg",
  locale: "vi-VN",
  timezoneId: "Asia/Ho_Chi_Minh",
}

function harness(launcher: BrowserLauncher, archive?: CaptureArchive) {
  const logger = new MemoryLogger()
  const kernel = new Kernel({
    registry: new SessionRegistry(new MemorySessionStore(), logger),
    guard: new BudgetGuard({ store: new MemoryCounterStore(), ceilings: DEFAULT_CEILINGS }),
    browser: launcher,
    logger,
  })
  const runs = new MemoryHarvestRunStore()
  const items = new MemoryRawItemStore()
  const recorded: { outcome: string; minutes: number }[] = []
  return {
    logger,
    runs,
    items,
    recorded,
    deps: {
      kernel,
      runs,
      items,
      archive: archive ?? new MemoryCaptureArchive(),
      pacer: immediatePacer,
      logger,
      personas: {
        async recordSession(_id: string, outturn: { minutes: number; outcome: string }) {
          recorded.push({ outcome: outturn.outcome, minutes: outturn.minutes })
        },
      },
    },
  }
}

const INPUT = { domainId: "atlas", persona: PERSONA, query: "xin chào thế giới" }

describe("runHarvest", () => {
  it("writes the items, the run row, and the archived bytes", async () => {
    const h = harness(fakeLauncher().launcher)
    const result = await runHarvest(fakeAdapter(), h.deps, INPUT)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.outcome).toBe("ok")
    expect(result.value.itemCount).toBe(1)
    expect(h.items.items).toHaveLength(1)
    expect(h.items.items[0]?.harvestRunId).toBe(result.value.runId)
    expect(h.items.items[0]?.rawRef).toBe(result.value.rawRef)
    expect((await h.runs.byId(result.value.runId))?.outcome).toBe("ok")
  })

  it("asks through the persona's viewpoint, not the default one", async () => {
    const h = harness(fakeLauncher().launcher)
    await runHarvest(fakeAdapter(), h.deps, INPUT)
    const open = h.logger.events.find((e) => e.event === "session.open")
    // P1.0 measured the query language to be the dominant signal and the locale to
    // matter more than nothing. A harvest that drops the viewpoint is asking as an
    // American with extra steps.
    expect(open).toMatchObject({ country: "sg", locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" })
  })

  it("archives the bytes before parsing them", async () => {
    const order: string[] = []
    const archive: CaptureArchive = {
      async put() {
        order.push("archive")
        return "captures/fake/1.json"
      },
    }
    const adapter = fakeAdapter()
    const base = adapter.parse.bind(adapter)
    adapter.parse = (c) => {
      order.push("parse")
      return base(c)
    }
    const h = harness(fakeLauncher().launcher, archive)
    await runHarvest(adapter, h.deps, INPUT)
    // Parsing is the step most likely to throw on a page that changed shape
    // overnight, and a throw that discards the bytes proving what changed turns a
    // ten-minute fix into a re-harvest.
    expect(order).toEqual(["parse", "archive"])
  })

  it("reports a refusal as a result, not as an error", async () => {
    const h = harness(fakeLauncher().launcher)
    const result = await runHarvest(fakeAdapter({ refusedBy: "consent" }), h.deps, INPUT)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.outcome).toBe("blocked")
    expect(result.value.refusedBy).toBe("consent")
    // The caller asked what happened. This is what happened.
    expect((await h.runs.byId(result.value.runId))?.outcome).toBe("blocked")
  })

  it("keeps the bytes that prove a refusal", async () => {
    const archive = new MemoryCaptureArchive()
    const h = harness(fakeLauncher().launcher, archive)
    const result = await runHarvest(fakeAdapter({ refusedBy: "captcha" }), h.deps, INPUT)

    if (!result.ok) throw new Error("expected a report")
    // The most valuable artefact a harvest produces is the evidence for what the
    // viewpoint was refused by.
    expect(archive.objects.size).toBe(1)
    expect(result.value.rawRef).not.toBeNull()
  })

  it("does not retry a refusal", async () => {
    const fake = fakeLauncher()
    const h = harness(fake.launcher)
    await runHarvest(fakeAdapter({ refusedBy: "consent" }), h.deps, { ...INPUT, attempts: 3 })
    // Asking again only teaches the source that this identity retries.
    expect(fake.launches).toBe(1)
  })

  it("tells the persona it was blocked, which is what the ban detector reads", async () => {
    const h = harness(fakeLauncher().launcher)
    await runHarvest(fakeAdapter({ refusedBy: "consent" }), h.deps, INPUT)
    expect(h.recorded.map((r) => r.outcome)).toEqual(["blocked"])
  })

  it("distinguishes an honest empty result from a refusal", async () => {
    const h = harness(fakeLauncher().launcher)
    const result = await runHarvest(fakeAdapter({ entries: [] }), h.deps, INPUT)

    if (!result.ok) throw new Error("expected a report")
    expect(result.value.outcome).toBe("empty")
    expect(result.value.refusedBy).toBeNull()
    // `empty` says the source answered and had nothing. `blocked` says it refused
    // to answer. Collapsing them would make a banned persona look like a bad query.
    expect(h.recorded.map((r) => r.outcome)).toEqual(["ok"])
  })

  it("finishes the run even when the provider never came back", async () => {
    const h = harness(fakeLauncher({ failAlways: "ECONNREFUSED" }).launcher)
    const result = await runHarvest(fakeAdapter(), h.deps, { ...INPUT, attempts: 2 })

    expect(result.ok).toBe(false)
    const runs = await h.runs.list()
    // A run row left `running` forever is a row somebody has to reconcile by hand.
    expect(runs).toHaveLength(1)
    expect(runs[0]?.outcome).toBe("error")
    expect(runs[0]?.endedAt).not.toBeNull()
  })

  it("does not bill a launch that never opened a session", async () => {
    const h = harness(fakeLauncher({ failFirst: "ECONNRESET" }).launcher)
    const result = await runHarvest(fakeAdapter(), h.deps, { ...INPUT, attempts: 2 })

    if (!result.ok) throw new Error("expected a report")
    // Two attempts, one session. The kernel meters what opened, and a launch that
    // threw opened nothing — there is no slot held and nothing to bill. Asserting
    // two here would be asserting that we over-report our own spend.
    expect(result.value.sessions).toBe(1)
    expect(h.recorded).toHaveLength(1)
  })

  it("bills every session, including the one whose work failed", async () => {
    let calls = 0
    const adapter = fakeAdapter()
    const base = adapter.capture.bind(adapter)
    adapter.capture = async (ctx, query) => {
      calls += 1
      // Thrown after the session is open, which is the case that costs money: the
      // provider bills a session that ran and failed.
      if (calls === 1) throw new Error("ECONNRESET")
      return base(ctx, query)
    }

    const h = harness(fakeLauncher().launcher)
    const result = await runHarvest(adapter, h.deps, { ...INPUT, attempts: 2 })

    if (!result.ok) throw new Error("expected a report")
    // A report that counts only the successful attempt is the 32% under-report
    // from P1.0 wearing a new hat.
    expect(result.value.sessions).toBe(2)
    expect(h.recorded).toHaveLength(2)
    expect(result.value.outcome).toBe("ok")
  })

  it("refuses an empty query rather than asking the source nothing", async () => {
    const fake = fakeLauncher()
    const h = harness(fake.launcher)
    const result = await runHarvest(fakeAdapter(), h.deps, { ...INPUT, query: "   " })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe("config")
    expect(fake.launches).toBe(0)
  })

  it("writes no items when their bytes could not be archived", async () => {
    const archive: CaptureArchive = {
      async put() {
        throw new Error("bucket unreachable")
      },
    }
    const h = harness(fakeLauncher().launcher, archive)
    const result = await runHarvest(fakeAdapter(), h.deps, INPUT)

    // An item without a `rawRef` can never be re-extracted: it looks like evidence
    // and cannot be re-read when the extraction model changes, which is the entire
    // reason captures are stored. A loud outage beats a quiet corruption.
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe("internal")
    expect(h.items.items).toHaveLength(0)

    const runs = await h.runs.list()
    expect(runs[0]?.outcome).toBe("error")
    expect(runs[0]?.endedAt).not.toBeNull()
  })

  it("paces the source from inside the session, not in addition to it", async () => {
    const waited: string[] = []
    const pacer = {
      async wait(sourceId: string) {
        waited.push(sourceId)
      },
    }
    const h = harness(fakeLauncher().launcher)
    await runHarvest(fakeAdapter(), { ...h.deps, pacer }, INPUT)
    expect(waited).toEqual(["fake.search"])
  })

  it("paces per source, so one adapter cannot throttle another", async () => {
    const pacer = new MemoryPacer({ rules: { "fake.search": { minIntervalMs: 0 } } })
    const h = harness(fakeLauncher().launcher)
    const result = await runHarvest(fakeAdapter(), { ...h.deps, pacer }, INPUT)
    expect(result.ok).toBe(true)
  })
})
