import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { SOURCE_ADAPTERS, sourceRegistry } from "./sources.js"

/**
 * Two hand-written lists of the same adapters, kept honest.
 *
 * `boot.ts` decides what a queued job may spend money on; `record-capture.ts`
 * decides what a person at a terminal may spend money on. Neither can be derived
 * from the other — one holds constructed adapters and the other holds factories that
 * take a settle time — and an adapter wired into one and not the other is not a type
 * error. It happened while P1.6 was being wired, `pnpm check` stayed green, and it
 * was caught by eye. This is the guard that means it is not caught by eye next time.
 *
 * The recorder is read as text rather than imported: it parses `process.argv` and
 * calls `process.exit` at module scope, which is right for a script and unimportable
 * in a test.
 */
const RECORDER = readFileSync(
  fileURLToPath(new URL("./record-capture.ts", import.meta.url)),
  "utf8",
)

describe("the source registry", () => {
  it("is keyed by each adapter's own id", () => {
    const registry = sourceRegistry()
    expect(registry.size).toBe(SOURCE_ADAPTERS.length)
    for (const adapter of SOURCE_ADAPTERS) {
      expect(registry.get(adapter.id)).toBe(adapter)
    }
  })

  it("names every adapter exactly once", () => {
    const ids = SOURCE_ADAPTERS.map((adapter) => adapter.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("offers the recorder the same sources the worker will run", () => {
    // A surface nobody can record is a surface whose selectors are guesses forever,
    // and a surface the worker cannot run is a fixture nobody can use.
    for (const adapter of SOURCE_ADAPTERS) {
      expect(RECORDER, `${adapter.id} is missing from record-capture.ts`).toContain(
        `"${adapter.id}":`,
      )
    }
  })

  it("still has every source it had when this was written", () => {
    // Removing one is a decision, not a refactor: a deployment that quietly stops
    // being able to run a source reports no error and produces no evidence.
    expect(SOURCE_ADAPTERS.map((adapter) => adapter.id).sort()).toEqual(
      [
        "maps.reviews",
        "maps.search",
        "pantip.forum",
        "pantip.tag",
        "pantip.topic",
        "tiktok.explore",
        "tiktok.search",
        "youtube.search",
        "youtube.trending",
      ].sort(),
    )
  })
})
