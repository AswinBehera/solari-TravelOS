# ADR-0006: The LLM layer is provider-agnostic

- **Status:** Accepted; amended in part by ADR-0012
- **Date:** 2026-09-11
- **Decided by:** Aswin (architect)

## Context

Extraction (section 2.5) is the highest-volume model call in the system: every harvested item is
read by a model at least once. At that volume, cost per token dominates every other property,
including which model produces the nicest prose.

Which model is cheapest-that-works is not knowable in advance. It is measurable, and cheap to
measure, because replaying stored `RawItem` rows costs nothing on the Solari meter.

## Decision

`@samsara/llm` exposes a narrow interface — complete, extract, embed — and no caller names a
provider or a model. The model for each task comes from configuration.

ADR-0012 amends the default route: it is OpenRouter, not a direct Anthropic key.

## Consequences

- The extraction model is chosen at P2.1 by measurement against a fixture set, not by preference.
- Swapping it is an env var, so a bad choice costs a redeploy rather than a refactor.
- The token meters in section 8 count input and output separately, because they are priced
  separately — which only works if every call goes through one place. This is that place.
- Cost: the interface is the least-common-denominator of its providers. Provider-specific features
  (extended thinking, server-side tools) are reachable only by widening the interface deliberately.

## Swap point

Any provider behind the interface; see ADR-0012 for the gateway-level swap.
