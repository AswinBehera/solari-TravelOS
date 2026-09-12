import type { ProfileStore } from "@samsara/kernel"
import { MemoryLogger } from "@samsara/kernel"
import { describe, expect, it } from "vitest"
import { createPersona, newProxySessionKey } from "./create.js"
import { MemoryPersonaStore } from "./store.js"

/** A provider that keeps profiles in a Map, so no test here talks to anyone. */
function fakeProfiles(behaviour: { failCreate?: boolean } = {}) {
  const rows = new Map<string, string>()
  let n = 0
  const store: ProfileStore = {
    async create(name) {
      if (behaviour.failCreate) throw new Error("provider said no")
      const id = `prof-${++n}`
      rows.set(id, name)
      return { id, name }
    },
    async list() {
      return [...rows].map(([id, name]) => ({ id, name }))
    },
    async save() {
      return { version: 1, sizeBytes: 0 }
    },
    async delete(id) {
      rows.delete(id)
    },
  }
  return { store, rows }
}

const input = {
  name: "night market regular",
  locality: "District 1",
  country: "sg",
  locale: "vi-VN",
  timezoneId: "Asia/Ho_Chi_Minh",
}

describe("createPersona", () => {
  it("writes a row with a sticky proxy key and no profile, by default", async () => {
    const store = new MemoryPersonaStore()
    const logger = new MemoryLogger()
    const result = await createPersona({ store, logger }, input)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.tier).toBe("anon")
    expect(result.value.solariProfileId).toBeNull()
    expect(result.value.proxySession).toMatch(/^[0-9a-f]{16}$/)
    expect(await store.byId(result.value.id)).not.toBeNull()
    expect(logger.events.map((e) => e.event)).toContain("persona.created")
  })

  it("starts with lastAliveAt null — creation is not evidence of life", async () => {
    const store = new MemoryPersonaStore()
    const result = await createPersona({ store }, input)
    expect(result.ok && result.value.lastAliveAt).toBeNull()
  })

  it("refuses a country the provider's pool does not have, and names the nearest", async () => {
    const store = new MemoryPersonaStore()
    const result = await createPersona({ store }, { ...input, country: "vn" })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe("config")
    expect(result.error.message).toContain("nearest available")
    expect(store.rows.size).toBe(0)
  })

  it("refuses an offset where an IANA zone belongs", async () => {
    const store = new MemoryPersonaStore()
    const result = await createPersona({ store }, { ...input, timezoneId: "GMT+7" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain("IANA")
  })

  it("refuses a seeded persona when there is nowhere to keep what it learns", async () => {
    const store = new MemoryPersonaStore()
    const result = await createPersona({ store }, { ...input, tier: "seeded" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain("profile store")
    // Not silently downgraded to anon: a persona that looks seeded and accumulates
    // nothing is the failure this refusal exists to prevent.
    expect(store.rows.size).toBe(0)
  })

  it("takes a provider profile for a seeded persona, named by id rather than by name", async () => {
    const store = new MemoryPersonaStore()
    const profiles = fakeProfiles()
    const result = await createPersona(
      { store, profiles: profiles.store },
      { ...input, tier: "seeded" },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.solariProfileId).toBe("prof-1")
    expect(profiles.rows.get("prof-1")).toBe(`persona-${result.value.id}`)
    expect(profiles.rows.get("prof-1")).not.toContain(input.name)
  })

  it("writes no row when the provider refuses the profile", async () => {
    const store = new MemoryPersonaStore()
    const profiles = fakeProfiles({ failCreate: true })
    const result = await createPersona(
      { store, profiles: profiles.store },
      { ...input, tier: "seeded" },
    )
    expect(result.ok).toBe(false)
    expect(store.rows.size).toBe(0)
  })

  it("deletes the profile it just took when the row cannot be written", async () => {
    const store = new MemoryPersonaStore()
    const profiles = fakeProfiles()
    // Same id twice: the second insert throws, which is the ordering hazard the
    // cleanup exists for — a profile at the provider with no row pointing at it.
    const fixedId = () => "11111111-2222-4333-8444-555555555555"
    const first = await createPersona(
      { store, profiles: profiles.store, newId: fixedId },
      { ...input, tier: "seeded" },
    )
    expect(first.ok).toBe(true)
    const second = await createPersona(
      { store, profiles: profiles.store, newId: fixedId },
      { ...input, tier: "seeded" },
    )
    expect(second.ok).toBe(false)
    expect(profiles.rows.has("prof-2")).toBe(false)
    expect(profiles.rows.has("prof-1")).toBe(true)
  })

  it("refuses a nameless identity", async () => {
    const store = new MemoryPersonaStore()
    expect((await createPersona({ store }, { ...input, name: "  " })).ok).toBe(false)
    expect((await createPersona({ store }, { ...input, locality: "" })).ok).toBe(false)
  })

  it("logs the persona's country and locale but never its locality", async () => {
    const store = new MemoryPersonaStore()
    const logger = new MemoryLogger()
    await createPersona({ store, logger }, input)
    const line = JSON.stringify(logger.events)
    expect(line).toContain("sg")
    expect(line).not.toContain(input.locality)
  })
})

describe("newProxySessionKey", () => {
  it("is opaque and does not leak the persona id to the vendor", async () => {
    const store = new MemoryPersonaStore()
    const result = await createPersona({ store }, input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { id, proxySession } = result.value
    expect(proxySession).toHaveLength(16)
    // The key the vendor sees must not be reconstructible from the persona id, or
    // the vendor's logs and ours become joinable by anyone holding either.
    expect(id.replace(/-/g, "")).not.toContain(proxySession)
    expect(newProxySessionKey(() => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")).toHaveLength(16)
  })

  it("differs between two personas created in the same breath", async () => {
    const store = new MemoryPersonaStore()
    const a = await createPersona({ store }, input)
    const b = await createPersona({ store }, input)
    expect(a.ok && b.ok && a.value.proxySession).not.toBe(b.ok ? b.value.proxySession : null)
  })
})
