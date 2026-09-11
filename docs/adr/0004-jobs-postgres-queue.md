# ADR-0004: Jobs run from a Postgres table, not a queue

- **Status:** Superseded in its original form by ADR-0014; the current decision is below
- **Date:** 2026-09-11 (original), amended the same day
- **Decided by:** Aswin (architect), amended by ADR-0014

## Context

**Originally:** BullMQ on Redis, with an always-on worker consuming a queue. That is the correct
shape when a consumer is always running.

ADR-0014 removed the always-on consumer. `apps/worker` became a scheduled GitHub Actions job that
wakes, drains, and exits. A queue exists to hand work to a listener; there is no listener.

## Decision

A `jobs` table in Postgres. The runner claims work with `SELECT ... FOR UPDATE SKIP LOCKED`, drains
what it claims, and exits. No Redis, no BullMQ.

## Consequences

- One fewer vendor and one fewer line item, out of a $20 budget (section 8).
- Job state is visible in the same database as everything else, so a failed run is debuggable with
  a query rather than with a queue dashboard.
- `SKIP LOCKED` gives safe concurrency if two runners ever overlap, which a cron schedule makes
  possible.
- Cost: latency is bounded below by the cron interval. Nothing in Phase 0 to 3 needs sub-minute
  pickup; the editor's own progress stream is SSE from the API, not from the queue.
- Redis was removed from `docker-compose.yml` and `.env.example` when this was amended.

## Swap point

BullMQ on Upstash, if a job ever needs sub-minute latency or fan-out that a scheduled drain cannot
give.
