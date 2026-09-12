import { PackRegistry } from "@samsara/refine"

/**
 * Domain packs, wired in at boot (section 2.5, ADR-0010).
 *
 * **Zero packs are registered, and that is the point of the file.** P0.5's job is
 * to prove the runner has no vertical compiled into it. The travel pack is
 * registered here by P2.6 — one `registry.register(travelPack)` line — and if that
 * line ever needs to be accompanied by anything else, the seam has a hole in it.
 *
 * It is a function rather than a module-level constant so that a test can build an
 * independent registry, and so that registration order is somewhere a reader can
 * see rather than being an import side effect.
 */
export function createPackRegistry(): PackRegistry {
  const registry = new PackRegistry()
  // P2.6: registry.register(travelPack)
  return registry
}
