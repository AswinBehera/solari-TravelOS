# ADR-0009: The service layer is domain-agnostic and named Samsara

- **Status:** Accepted
- **Date:** 2026-09-11
- **Decided by:** Aswin (architect)
- **Supersedes:** the framing in `docs/origin/os_infrastructure_deep_dive.md`

## Context

v1 of the plan described a "Travel OS" whose packages happened not to be very travel-specific.
`kernel`, `personas`, `harvest`, `refine`, and `eyes` contained almost nothing about travel;
what leaked was the `Place` schema, the adapter query sets, the scoring keywords, and the
document UI.

The horizontal primitive underneath the product is *situated observation*: seeing the internet
exactly as a specific kind of person in a specific place sees it, at scale, repeatedly, and
turning that into structured evidence. That primitive has buyers outside travel — algorithm
auditing, geo-pricing intelligence, localised SERP and ad monitoring, in-language market
research, diaspora feeds — and most of them are B2B and pay considerably more than a traveller
paying for a Pro plan.

The risk in both directions is real. Leave the layers fused and vertical two is a rewrite.
Build a platform first and it dies without a wedge.

## Decision

Split the repo into two package scopes with an enforced boundary:

- `@samsara/*` under `packages/samsara/` — the domain-agnostic service layer over Solari.
  Named for the observation that each persona is the same machinery looking at the world
  through a different incarnation.
- `@dt/*` under `packages/travel/` — Doen Thang, vertical one.

The arrow points one way: travel depends on Samsara, never the reverse.

Enforcement is mechanical, in `pnpm check:seam`, run in CI and required by the definition
of done:

1. **Lexicon check** — fail on a word-boundary hit for `travel`, `trip`, `place` (as an
   identifier), `postcard`, `hotel`, `flight`, `itinerary`, `tourist`, `bangkok`, `tokyo`,
   `restaurant`, `booking` anywhere under `packages/samsara/`. Line-level `// seam:allow <reason>`
   is the escape hatch; the check counts and prints them.
2. **Dependency direction check** — fail if any `packages/samsara/*/package.json` lists a
   `@dt/*` dependency.

Source adapters are the subtle case, and the rule is that **adapters are per-source, not
per-domain**. A TikTok adapter or a Booking.com price adapter is horizontal; an algorithm
auditor and a pricing analyst want the identical file. What is travel-specific is which
queries run, in which city, and what is concluded from the results.

## Consequences

- Vertical two is a domain pack (ADR-0010) plus a UI, not a fork.
- We pay a modest tax now: two scopes, an `EntityRepo` indirection, `domainId` on several
  tables, and a CI check to maintain.
- If the allow-count exceeds five, the seam is in the wrong place and gets redesigned rather
  than papered over.
- One repo, not two. Extraction to a separate repo is a `git filter-repo` when a paying
  non-travel customer exists, not a refactor.

## Alternatives rejected

- **Single `@dt/*` namespace, seam by convention.** Cheapest today. Conventions without a
  check do not survive a deadline.
- **Two repos now.** Correct eventually, premature for a solo builder pre-PMF. Pays the
  versioning and release tax before there is anything to version.
