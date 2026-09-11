# ADR-0011: "OS" is product language, not architecture

- **Status:** Accepted
- **Date:** 2026-09-11
- **Decided by:** Aswin (architect)

## Context

The original docs argued that Doen Thang *is* an operating system: Solari microVMs as hardware,
the Node server as kernel, profiles as filesystem, Postcards as sandboxed apps. It is a good
metaphor and a bad architecture description. There is no process table, no memory manager, no
syscall boundary, no scheduler in any sense a systems engineer would accept. What exists is
session orchestration over a compute API, a job queue, and a pipeline.

The cost of leaving the claim in place is that executors reason about the code through a
metaphor instead of through what it does.

The cost of removing it entirely is that the product loses the frame that makes it legible. The
design canvas already ships `TRAVEL OS` in the top bar, a `/kernel` ops screen, and loading
states that name the daemon doing the work — and those are honest, because the daemons are real
background processes that continue when the tab is closed.

## Decision

Keep "OS" in the product. Remove it from the architecture.

- **Product surface** — UI copy, landing page, the `/kernel` screen, loading states: TravelOS
  stays. The `@samsara/kernel` package keeps its name, because the ops screen is called
  `/kernel` and the metaphor is load-bearing in the product.
- **Everything else** — plan prose, schemas, log fields, queue names, ADRs, READMEs: service
  layer, orchestrator, pipeline, scheduler.

`docs/PLAN.md` section 1.5's mapping table is retained explicitly as a **product rubric** for
deciding what belongs in v1, not as an architecture diagram.

## Consequences

- The metaphor is conditional on the daemons staying real. If background work, persistent
  personas, and executable Postcards stop being true, the word becomes a lie and we drop it
  from the product too.
- `docs/origin/*` are marked superseded rather than deleted; they hold the product feeling and
  the flywheel argument, which still stand.
