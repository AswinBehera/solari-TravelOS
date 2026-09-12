/**
 * The `DomainPack` contract's identity half, and deliberately only that half.
 *
 * Section 2.5 specifies the whole thing — `extract`, `entity`, `resolve`,
 * `dedupKeys`, `score`, `sources`, `queries` — and P2.2 to P2.5 build the pipeline
 * that consumes it. Writing those members now would mean inventing `RawItem`
 * batching, `EntityRepo` and `ScoreSet` plumbing against no caller, and the first
 * real pack would then be shaped by guesses rather than the guesses being
 * corrected by it.
 *
 * What P0.5 needs is narrower and worth having early: a registry that is typed,
 * that `apps/worker` holds at boot, and that has **zero packs in it**. An empty
 * registry is not a placeholder — it is the assertion that the runner has no
 * vertical compiled into it, which is the property P2.8 will later try to break by
 * running a second, non-travel pack through the same pipeline.
 */
export interface DomainPackIdentity {
  /** `"travel"`. Stamped on every Mention, Evidence, Session and Job row. */
  id: string
  /** Bumped when prompts or weights change; stored with each Evidence row. */
  version: string
}

/**
 * Widened to the full contract in P2.2. Callers should already type against this
 * name so that the widening is a change in one file rather than in every consumer.
 */
export type DomainPack = DomainPackIdentity

/**
 * `Map<string, DomainPack>` from section 2.5, with the invariant the plain Map
 * cannot express: a pack's key is its own `id`, so nothing can be registered under
 * a name it does not answer to, and registering twice is a bug rather than a
 * silent replacement.
 */
export class PackRegistry {
  private readonly packs = new Map<string, DomainPack>()

  get size(): number {
    return this.packs.size
  }

  register(pack: DomainPack): void {
    if (this.packs.has(pack.id)) {
      throw new Error(`domain pack already registered: ${pack.id}`)
    }
    this.packs.set(pack.id, pack)
  }

  get(id: string): DomainPack | undefined {
    return this.packs.get(id)
  }

  /**
   * Throws rather than returning undefined, and names the registered ids in the
   * message. A job carrying a `domainId` nobody registered is a deployment
   * mistake — the runner shipped without the pack — and it should say so once,
   * loudly, rather than being handled as an ordinary missing value at every call
   * site downstream.
   */
  require(id: string): DomainPack {
    const pack = this.packs.get(id)
    if (!pack) {
      throw new Error(
        `no domain pack registered for "${id}" (registered: ${[...this.packs.keys()].join(", ") || "none"})`,
      )
    }
    return pack
  }

  ids(): string[] {
    return [...this.packs.keys()]
  }
}
