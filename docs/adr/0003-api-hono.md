# ADR-0003: Hono for the HTTP API

- **Status:** Accepted
- **Date:** 2026-09-11
- **Decided by:** Aswin (architect)

## Context

`apps/api` does three things: verify a JWT, read and write rows, and stream progress to the editor.
It is thin by design — the pipeline runs in the worker, not in a request handler.

## Decision

Hono on Node 22, with typed routes and Zod validation at the edge of every handler.

## Consequences

- Hono runs unchanged on Node and on Cloudflare Workers, which is what let ADR-0014 move the API to
  a free Worker without rewriting a handler. This was luck at the time of the decision and is the
  main reason it still holds.
- Small enough to read end to end, which matters when the API's only real job is authorisation.
- Cost: a thinner plugin ecosystem than Fastify. Nothing in the plan needs one.

## Swap point

Fastify, if the API ever needs a plugin ecosystem — which would itself be a sign the API stopped
being thin, and worth questioning first.
