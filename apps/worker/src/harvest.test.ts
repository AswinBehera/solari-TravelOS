import { MemoryCaptureArchive, MemoryHarvestRunStore, MemoryRawItemStore } from "@samsara/harvest"
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
import { MemoryPersonaStore, type PersonaRecord } from "@samsara/personas"
import type { Capture, ItemDraft, SourceAdapter } from "@samsara/sources"
import { describe, expect, it } from "vitest"
import type { JobContext } from "./handlers.js"
import { createHarvestHandler } from "./harvest.js"
import { createPackRegistry } from "./packs.js"

/**
 * The handler's own job, which is smaller than it looks: validate a payload that
 * anything with the connection string can write, refuse to spend on an identity
 * that is finished, and hand the rest to `runHarvest`. Everything below tests one
 * of those three, because the orchestration itself is already tested where it
 * lives.
 */

function fakeLauncher() {
  let launches = 0
  const launcher: BrowserLauncher = {
    async launch(): Promise<BrowserHandle> {
      launches += 1
      return {
        id: `fake-${launches}`,
        async newPage() {
          return {}
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

const adapter: SourceAdapter<{ n: number }> = {
  id: "fake.source",
  async capture(_ctx, query): Promise<Capture<{ n: number }>> {
    return {
      sourceId: "fake.source",
      query,
      url: "https://fake.test/q",
      capturedAt: new Date("2026-09-12T00:00:00Z"),
      payload: { n: 2 },
    }
  },
  parse(capture): readonly ItemDraft[] {
    return Array.from({ length: capture.payload.n }, (_, i) => ({
      url: `https://fake.test/i/${i}`,
      title: `item ${i}`,
      text: "body",
      languageGuess: null,
      mediaRefs: [],
      engagement: null,
    }))
  },
}

async function harness(behaviour: { health?: PersonaRecord["health"] } = {}) {
  const logger = new MemoryLogger()
  const fake = fakeLauncher()
  const kernel = new Kernel({
    registry: new SessionRegistry(new MemorySessionStore(), logger),
    guard: new BudgetGuard({ store: new MemoryCounterStore(), ceilings: DEFAULT_CEILINGS }),
    browser: fake.launcher,
    logger,
  })
  const personas = new MemoryPersonaStore()
  const persona: PersonaRecord = {
    id: "p1",
    name: "regular",
    locality: "District 1",
    country: "sg",
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    tier: "anon",
    solariProfileId: null,
    proxySession: "sticky-1",
    health: behaviour.health ?? "healthy",
    seedPlanId: null,
    lastAliveAt: null,
    stats: { sessions: 0, minutes: 0, blocks: 0 },
  }
  await personas.insert(persona)

  const runs = new MemoryHarvestRunStore()
  const items = new MemoryRawItemStore()
  const handler = createHarvestHandler({
    sources: new Map([[adapter.id, adapter as unknown as SourceAdapter<unknown>]]),
    personas,
    runs,
    items,
    archive: new MemoryCaptureArchive(),
  })

  const notes: string[] = []
  const ctx = (payload: unknown): JobContext => ({
    job: { id: "j1", type: "harvest.run", payload } as JobContext["job"],
    kernel,
    packs: createPackRegistry(),
    logger,
    signal: new AbortController().signal,
    async heartbeat(note?: string) {
      if (note) notes.push(note)
    },
  })

  return { handler, ctx, runs, items, personas, notes, fake }
}

const PAYLOAD = { personaId: "p1", sourceId: "fake.source", query: "xin chào", domainId: "atlas" }

describe("harvest.run", () => {
  it("harvests, writes the items and reports what it cost", async () => {
    const h = await harness()
    await h.handler(h.ctx(PAYLOAD))
    expect(h.items.items).toHaveLength(2)
    const [run] = await h.runs.list({})
    expect(run?.outcome).toBe("ok")
    expect(h.notes.some((n) => n.startsWith("ok:"))).toBe(true)
  })

  it("tells the persona what happened, because the ban detector reads that", async () => {
    const h = await harness()
    await h.handler(h.ctx(PAYLOAD))
    const persona = await h.personas.byId("p1")
    expect(persona?.stats.sessions).toBe(1)
  })

  it("refuses a payload that is missing a field, before anything opens", async () => {
    const h = await harness()
    for (const key of ["personaId", "sourceId", "query", "domainId"]) {
      const payload: Record<string, unknown> = { ...PAYLOAD }
      delete payload[key]
      await expect(h.handler(h.ctx(payload))).rejects.toThrow(key)
    }
    expect(h.fake.launches).toBe(0)
  })

  it("refuses a blank query rather than asking the source nothing", async () => {
    const h = await harness()
    await expect(h.handler(h.ctx({ ...PAYLOAD, query: "   " }))).rejects.toThrow("query")
    expect(h.fake.launches).toBe(0)
  })

  it("refuses an unregistered source without opening a session", async () => {
    // Not retried, and deliberately so: a source that is not registered will not
    // become registered by trying again in thirty seconds.
    const h = await harness()
    await expect(h.handler(h.ctx({ ...PAYLOAD, sourceId: "nope" }))).rejects.toThrow("no adapter")
    expect(h.fake.launches).toBe(0)
  })

  it("refuses to spend on a banned identity", async () => {
    const h = await harness({ health: "banned" })
    await expect(h.handler(h.ctx(PAYLOAD))).rejects.toThrow("banned")
    expect(h.fake.launches).toBe(0)
  })

  it("throws rather than swallowing, so classify decides about the retry", async () => {
    const h = await harness()
    await expect(h.handler(h.ctx({ ...PAYLOAD, personaId: "ghost" }))).rejects.toThrow(
      "no such persona",
    )
  })
})
