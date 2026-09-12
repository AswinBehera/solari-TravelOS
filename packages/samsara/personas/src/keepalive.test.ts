import {
  type BrowserHandle,
  type BrowserLauncher,
  BudgetGuard,
  DEFAULT_CEILINGS,
  Kernel,
  MemoryCounterStore,
  MemoryLogger,
  MemorySessionStore,
  type ProfileStore,
  SessionRegistry,
} from "@samsara/kernel"
import { describe, expect, it } from "vitest"
import { createPersona } from "./create.js"
import { keepalive } from "./keepalive.js"
import { MemoryPersonaStore, type PersonaRecord } from "./store.js"

/**
 * A browser that never existed. Records what was visited and whether anyone asked
 * for the storage state — which is the assertion this file exists to make.
 */
function fakeLauncher(behaviour: { failFirst?: string; gotoStatus?: number } = {}) {
  const visited: string[] = []
  const stateReads: number[] = []
  let launches = 0
  const launcher: BrowserLauncher = {
    async launch(): Promise<BrowserHandle> {
      launches += 1
      if (behaviour.failFirst && launches === 1) throw new Error(behaviour.failFirst)
      return {
        id: `fake-${launches}`,
        async newPage() {
          return {
            async goto(url: string) {
              visited.push(url)
              // A refusal is a response, not an exception. That is the whole point.
              return { status: () => behaviour.gotoStatus ?? 200 }
            },
            context() {
              return {
                async storageState() {
                  stateReads.push(Date.now())
                  return { cookies: [], origins: [] }
                },
              }
            },
          }
        },
        async close() {},
      }
    },
    async dispose() {},
  }
  return {
    launcher,
    visited,
    stateReads,
    get launches() {
      return launches
    },
  }
}

function fakeProfiles() {
  const saves: { id: string; state: unknown }[] = []
  const store: ProfileStore = {
    async create(name) {
      return { id: "prof-1", name }
    },
    async list() {
      return []
    },
    async save(id, state) {
      saves.push({ id, state })
      return { version: saves.length, sizeBytes: 4096 }
    },
    async delete() {},
  }
  return { store, saves }
}

function harness(launcher: BrowserLauncher) {
  const logger = new MemoryLogger()
  const kernel = new Kernel({
    registry: new SessionRegistry(new MemorySessionStore(), logger),
    guard: new BudgetGuard({ store: new MemoryCounterStore(), ceilings: DEFAULT_CEILINGS }),
    browser: launcher,
    logger,
  })
  return { kernel, logger, store: new MemoryPersonaStore() }
}

async function seeded(store: MemoryPersonaStore, profiles?: ProfileStore) {
  const result = await createPersona(
    { store, ...(profiles ? { profiles } : {}) },
    {
      name: "regular",
      locality: "District 1",
      country: "sg",
      locale: "vi-VN",
      timezoneId: "Asia/Ho_Chi_Minh",
      ...(profiles ? { tier: "seeded" as const } : {}),
    },
  )
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

const URLS = ["https://example.com/a", "https://example.com/b"]

describe("keepalive", () => {
  it("visits the caller's pages and persists what the session accumulated", async () => {
    const fake = fakeLauncher()
    const { kernel, logger, store } = harness(fake.launcher)
    const profiles = fakeProfiles()
    const persona = await seeded(store, profiles.store)

    const result = await keepalive(
      { kernel, store, profiles: profiles.store, logger },
      { personaId: persona.id, urls: URLS, dwellMs: 0 },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.visited).toEqual(URLS)
    // The whole point. Attaching a profile persists nothing on its own.
    expect(profiles.saves).toHaveLength(1)
    expect(profiles.saves[0]?.id).toBe("prof-1")
    expect(result.value.saved).toBe(true)
    expect(result.value.savedBytes).toBe(4096)
  })

  it("reads the storage state before the browser is closed", async () => {
    // If `save` ever moved outside the kernel callback it would still typecheck,
    // still log `saved: true`, and silently persist nothing — the context is gone
    // by then. The only observable difference is ordering, so this asserts it.
    const fake = fakeLauncher()
    const { kernel, store } = harness(fake.launcher)
    const profiles = fakeProfiles()
    const persona = await seeded(store, profiles.store)
    await keepalive(
      { kernel, store, profiles: profiles.store },
      { personaId: persona.id, urls: URLS, dwellMs: 0 },
    )
    expect(fake.stateReads).toHaveLength(1)
    expect(profiles.saves).toHaveLength(1)
  })

  it("says out loud when it saved nothing", async () => {
    const fake = fakeLauncher()
    const { kernel, logger, store } = harness(fake.launcher)
    const persona = await seeded(store) // anon: no profile to save into

    const result = await keepalive(
      { kernel, store, logger },
      { personaId: persona.id, urls: URLS, dwellMs: 0 },
    )

    expect(result.ok && result.value.saved).toBe(false)
    const line = logger.events.find((e) => e.event === "persona.keepalive")
    expect(line).toMatchObject({ saved: false, visited: 2 })
  })

  it("bills the persona for every attempt, including the one that failed", async () => {
    const fake = fakeLauncher({ failFirst: "ECONNRESET" })
    const { kernel, store } = harness(fake.launcher)
    const persona = await seeded(store)

    const result = await keepalive(
      { kernel, store },
      { personaId: persona.id, urls: URLS, dwellMs: 0 },
    )

    expect(result.ok).toBe(true)
    // The failed launch never opened a session, so there is one session row; the
    // number that must match is the store's, not the number of calls made here.
    const row = await store.byId(persona.id)
    expect(row?.stats.sessions).toBe(result.ok ? result.value.sessions : -1)
  })

  it("records a blocked session and degrades the persona on the second one", async () => {
    const fake = fakeLauncher({ gotoStatus: 403 })
    const { kernel, store } = harness(fake.launcher)
    const persona = await seeded(store)

    await keepalive({ kernel, store }, { personaId: persona.id, urls: URLS, dwellMs: 0 })
    expect((await store.byId(persona.id))?.health).toBe("healthy")

    const second = await keepalive(
      { kernel, store },
      { personaId: persona.id, urls: URLS, dwellMs: 0 },
    )
    expect(second.ok).toBe(false)
    const row = await store.byId(persona.id)
    expect(row?.health).toBe("degraded")
    expect(row?.stats.blocks).toBeGreaterThanOrEqual(2)
  })

  it("moves lastAliveAt only when a session actually worked", async () => {
    const fake = fakeLauncher({ gotoStatus: 403 })
    const { kernel, store } = harness(fake.launcher)
    const persona = await seeded(store)
    await keepalive({ kernel, store }, { personaId: persona.id, urls: URLS, dwellMs: 0 })
    expect((await store.byId(persona.id))?.lastAliveAt).toBeNull()
  })

  it("refuses to spend on a banned identity", async () => {
    const fake = fakeLauncher()
    const { kernel, store } = harness(fake.launcher)
    const persona = await seeded(store)
    await store.setHealth(persona.id, "banned")

    const result = await keepalive(
      { kernel, store },
      { personaId: persona.id, urls: URLS, dwellMs: 0 },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe("config")
    expect(fake.launches).toBe(0)
  })

  it("refuses a session with nothing to visit", async () => {
    const fake = fakeLauncher()
    const { kernel, store } = harness(fake.launcher)
    const persona = await seeded(store)
    const result = await keepalive({ kernel, store }, { personaId: persona.id, urls: [] })
    expect(result.ok).toBe(false)
    expect(fake.launches).toBe(0)
  })

  it("launches with the persona's own viewpoint and sticky address", async () => {
    const configs: unknown[] = []
    const fake = fakeLauncher()
    const spy: BrowserLauncher = {
      launch: (config) => {
        configs.push(config)
        return fake.launcher.launch(config)
      },
      dispose: () => fake.launcher.dispose(),
    }
    const { kernel, store } = harness(spy)
    const persona: PersonaRecord = await seeded(store)
    await keepalive({ kernel, store }, { personaId: persona.id, urls: URLS, dwellMs: 0 })

    expect(configs[0]).toMatchObject({
      proxy: { country: "sg", session: persona.proxySession },
      viewpoint: { locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" },
    })
  })

  it("does not name the pages it visited in the log", async () => {
    const fake = fakeLauncher()
    const { kernel, logger, store } = harness(fake.launcher)
    const persona = await seeded(store)
    await keepalive({ kernel, store, logger }, { personaId: persona.id, urls: URLS, dwellMs: 0 })
    expect(JSON.stringify(logger.events)).not.toContain("example.com")
  })
})
