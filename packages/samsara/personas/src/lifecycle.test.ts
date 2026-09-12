import { MemoryLogger } from "@samsara/kernel"
import { describe, expect, it } from "vitest"
import { createPersona } from "./create.js"
import { reassess, retire, rotateProxySession } from "./lifecycle.js"
import { MemoryPersonaStore } from "./store.js"

const input = {
  name: "regular",
  locality: "District 1",
  country: "sg",
  locale: "vi-VN",
  timezoneId: "Asia/Ho_Chi_Minh",
}

async function persona(store: MemoryPersonaStore) {
  const result = await createPersona({ store }, input)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

describe("reassess", () => {
  it("writes the new state and emits the transition once", async () => {
    const store = new MemoryPersonaStore()
    const logger = new MemoryLogger()
    const p = await persona(store)
    const at = new Date("2026-09-12T10:00:00.000Z")
    for (const outcome of ["blocked", "blocked"] as const) {
      await store.recordSession(p.id, { minutes: 0.1, outcome, at })
    }

    const first = await reassess({ store, logger }, p.id)
    expect(first.ok && first.value.health).toBe("degraded")
    expect((await store.byId(p.id))?.health).toBe("degraded")
    expect(logger.events.filter((e) => e.event === "persona.health")).toHaveLength(1)

    // Called again with no new evidence: same verdict, no second event. Health
    // transitions are the thing anyone watching this fleet would alert on, and an
    // alert that repeats every drain is an alert nobody reads.
    const second = await reassess({ store, logger }, p.id)
    expect(second.ok && second.value.changed).toBe(false)
    expect(logger.events.filter((e) => e.event === "persona.health")).toHaveLength(1)
  })

  it("says which persona is missing rather than failing silently", async () => {
    const store = new MemoryPersonaStore()
    const result = await reassess({ store }, "11111111-2222-4333-8444-555555555555")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain("no such persona")
  })
})

describe("rotateProxySession", () => {
  it("gives a degraded identity a new address without touching anything else", async () => {
    const store = new MemoryPersonaStore()
    const p = await persona(store)
    await store.setHealth(p.id, "degraded")

    const rotated = await rotateProxySession({ store }, p.id)
    expect(rotated.ok).toBe(true)
    const row = await store.byId(p.id)
    expect(row?.proxySession).not.toBe(p.proxySession)
    expect(row?.health).toBe("degraded")
    expect(row?.locale).toBe(p.locale)
    expect(row?.solariProfileId).toBe(p.solariProfileId)
  })

  it("refuses for a banned persona, where the address is not what was recognised", async () => {
    const store = new MemoryPersonaStore()
    const p = await persona(store)
    await store.setHealth(p.id, "banned")
    const rotated = await rotateProxySession({ store }, p.id)
    expect(rotated.ok).toBe(false)
    expect((await store.byId(p.id))?.proxySession).toBe(p.proxySession)
  })
})

describe("retire", () => {
  it("is our decision and stays distinct from the surface's", async () => {
    const store = new MemoryPersonaStore()
    const logger = new MemoryLogger()
    const p = await persona(store)

    const result = await retire({ store, logger }, p.id)
    expect(result.ok && result.value.health).toBe("retired")
    expect((await store.byId(p.id))?.health).toBe("retired")
    const event = logger.events.find((e) => e.event === "persona.health")
    expect(event).toMatchObject({ from: "healthy", to: "retired" })
  })

  it("deletes the provider profile, the only part that cannot be rebuilt", async () => {
    const store = new MemoryPersonaStore()
    const p = await persona(store)
    await store.setProfile(p.id, "prof-9")
    const deleted: string[] = []

    await retire(
      {
        store,
        profiles: {
          async delete(id) {
            deleted.push(id)
          },
        },
      },
      p.id,
    )
    expect(deleted).toEqual(["prof-9"])
    expect((await store.byId(p.id))?.solariProfileId).toBeNull()
  })

  it("still retires when the provider cleanup fails", async () => {
    const store = new MemoryPersonaStore()
    const p = await persona(store)
    await store.setProfile(p.id, "prof-9")
    await retire(
      {
        store,
        profiles: {
          async delete() {
            throw new Error("provider unreachable")
          },
        },
      },
      p.id,
    )
    // Keeping a persona we have decided against in the rotation because a cleanup
    // call failed would be the cleanup dictating policy.
    expect((await store.byId(p.id))?.health).toBe("retired")
  })

  it("is idempotent", async () => {
    const store = new MemoryPersonaStore()
    const logger = new MemoryLogger()
    const p = await persona(store)
    await retire({ store, logger }, p.id)
    await retire({ store, logger }, p.id)
    expect(logger.events.filter((e) => e.event === "persona.health")).toHaveLength(1)
  })

  it("survives evidence arriving after the decision", async () => {
    const store = new MemoryPersonaStore()
    const p = await persona(store)
    await retire({ store }, p.id)
    const at = new Date("2026-09-12T10:00:00.000Z")
    for (const outcome of ["ok", "ok", "ok"] as const) {
      await store.recordSession(p.id, { minutes: 0.1, outcome, at })
    }
    const verdict = await reassess({ store }, p.id)
    expect(verdict.ok && verdict.value.health).toBe("retired")
  })
})
