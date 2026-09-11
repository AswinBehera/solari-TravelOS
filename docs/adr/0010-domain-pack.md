# ADR-0010: A vertical is a domain pack, not a plugin

- **Status:** Accepted
- **Date:** 2026-09-11
- **Decided by:** Aswin (architect)

## Context

ADR-0009 puts a boundary between the engine and the vertical. This ADR decides *where* on the
refine pipeline that boundary falls.

Three options were considered:

1. The engine stops at `Evidence`. Everything downstream — resolve, dedup, score, the entity
   itself — is travel code.
2. The engine owns the whole pipeline as generic machinery, parameterised by the vertical.
3. As 2, plus a generic `Entity` table that the vertical projects a typed view over.

## Decision

Option 2.

`@samsara/refine` owns the pipeline stages — batching, LLM calls, retry, caching, merge,
explanation capture, job chaining — and the `DomainPack<TMention, TEntity>` contract
(`docs/PLAN.md` section 2.5). A vertical supplies the knowledge: mention schema, prompt,
batching key, entity schema, an `EntityRepo`, a resolver, dedup keys, scoring factors, the
source list, and the query set.

A pack is a **plain TypeScript object**, imported and registered in a `Map<string, DomainPack>`
at worker boot. No dynamic loading, no manifest format, no sandbox.

Option 3 is explicitly rejected for now: each pack owns its own table behind `EntityRepo`, so
travel's `places` table is defined in `@dt/db` and the engine never imports it. Revisit only if
a third vertical needs cross-domain queries.

## Consequences

- Scores are a generic `ScoreSet` — a named map of `{ value, because: Explanation[] }`. Product
  principle 3, "show the algorithm", is therefore satisfied for any vertical without the engine
  knowing what a score means. `localScore` becomes `scores.local`.
- Engine tables that must point at a domain entity store an opaque `(domainId, entityId)` pair
  with no foreign key.
- The contract is validated by **P2.8**, which runs a throwaway non-travel pack through the same
  pipeline over the same raw data. Acceptance is zero edits under `packages/samsara/`. If that
  task needs engine changes, this ADR was wrong and P2.2 to P2.5 get revised before Phase 3.
- Anything a pack needs that the engine cannot give it is a missing engine capability, not a
  licence to cross the seam.

## Alternatives rejected

- **Option 1 (engine stops at Evidence).** Simpler, less abstraction, but vertical two rewrites
  the back half of the pipeline — which is the half where the hard-won quality work lives.
- **Option 3 (generic Entity table).** Maximum reuse, paid for in every query and in the
  ergonomics of the travel code we are actually shipping first.
- **A real plugin host.** A tax paid up front for flexibility nobody has asked for. Revisit if
  third parties ever write packs.
