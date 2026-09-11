# ADR-0012: OpenRouter is the LLM gateway; the model is config, not code

- **Status:** Accepted
- **Date:** 2026-09-11
- **Decided by:** Aswin (architect)
- **Amends:** ADR-0006 (LLM), which named a direct Claude Haiku key as the extraction default

## Context

The demo runs under a hard $20 ceiling. Extraction is the highest-volume LLM workload in the
system — every RawItem from every harvest run passes through it — so the model's per-token rate,
not its benchmark score, is the dominant term in what Phase 2 costs.

ADR-0006 already required `@samsara/llm` to be provider-agnostic, but it named a direct Anthropic
key as the default route and a direct Gemini key as the alternate. That shape has two problems
under a ceiling this tight:

1. **Switching models means switching vendors.** A new provider is a new key, a new SDK, a new
   error taxonomy, and a new billing relationship. That friction is exactly what stops anyone
   from trying the cheaper model.
2. **The cheapest adequate model is not known up front, and cannot be.** Extraction quality on
   noisy multilingual social text — Thai script especially — is an empirical question about our
   prompt and our data, not something a leaderboard answers.

## Decision

**OpenRouter is the single LLM gateway.** One key, one base URL, one wire format, many models.
`@samsara/llm` keeps the provider-agnostic interface from ADR-0006; OpenRouter becomes its
default and, for now, only implementation.

**The model for each task is an environment variable, never a literal in code.** `@samsara/llm`
exposes tasks (`extract`, `summarise`, …), not models. A task resolves to a model id at call time
from config. Changing which model does extraction is an env change and a redeploy, not a diff.

OpenRouter speaks the OpenAI wire format, so the client is the `openai` package pointed at
OpenRouter's base URL. It is never pointed at OpenAI.

## Consequences

- **The model bake-off becomes affordable, which is the real point.** Refine runs replay stored
  RawItems and open no browsers (section 8), so running the same 200 hand-labelled items through
  three candidate models costs nothing on the Solari meter. P2.1 picks the cheapest model that
  clears Phase 2's quality bar — 66% of top-30 places verified — by measurement.
- **The Anthropic Batch API's 50% discount is not available through OpenRouter.** This is a real
  loss and it is accepted: a Flash-class model at list price beats a frontier model at half price
  by a wider margin than the discount recovers.
- **OpenRouter adds a fee on credit purchases and a hop of latency.** Extraction is a nightly
  pipeline, so latency does not matter. The fee is small against the model savings.
- **Structured output support varies by model.** `@samsara/llm` must validate every response
  against the pack's Zod mention schema and treat a parse failure as a retryable error, not a
  crash. This was already required; ADR-0012 makes it load-bearing, because a cheaper model fails
  this way more often.
- **Free-tier (`:free`) models on OpenRouter carry rate limits and data-retention terms.** They
  are acceptable for harvested public content during development. They are not acceptable for
  anything derived from a real user's private trip data. The routing config must not quietly send
  the latter to a free tier.
- The LLM meter in the kernel's budget guard (section 2.4) counts tokens, not dollars, so it
  stays correct across a model swap.

## Alternatives rejected

- **Direct Anthropic key, as ADR-0006 had it.** Best-in-class extraction quality and the Batch
  API's 50% discount, but it makes trying a cheaper model a vendor migration — under a $20
  ceiling, the ability to swap matters more than the ceiling of any one model.
- **Direct Gemini key.** Cheap and good, but a single-vendor bet made before any measurement, and
  it forfeits the ability to A/B against anything else without writing a second adapter.
- **Self-hosted small model on a Solari sandbox.** Moves spend from the LLM meter onto the Solari
  meter at a far worse rate, and a sandbox dies on idle. Wrong shape entirely.
