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

### Amendment, P0.7: the lexicon is split, and imports are checked too

Implementing this check (`tools/check-seam.ts`) turned up two things the decision above got
wrong.

**A word-boundary hit is the wrong test.** Run against the real tree it produced ~44 failures,
and almost every one was ordinary English in a comment: "one round trip", "cancelled
mid-flight", "the only place this happens". A check that cries wolf forty times gets switched
off, and forty `seam:allow` comments would have blown an allowance ceiling of five on the day
it shipped. But the opposite rule — blank all comments, scan only code — is blind in the other
direction: the engine's own comments said things like *"plan section 1.4 names Bangkok as the
first city"*, which is the engine knowing precisely what it is forbidden to know. Comments are
where domain knowledge leaks **first**, because a comment is where a person explains *why* in
product terms.

So the list is cut by how ambiguous each word is in English, not by where it sits:

- **Unambiguous** — `bangkok`, `tokyo`, `postcard`, `itinerary`, `tourist`, `hotel`,
  `restaurant`. Nobody writes these by accident. Scanned everywhere, comments included.
- **Ordinary English** — `travel`, `trip`, `place`, `flight`, `booking`. Scanned in code and
  string literals only. A prompt saying "hotel" is a breach; a comment saying "round trip" is
  a sentence.

Within code, matching is by **identifier segment**, not word boundary: `\btravel\b` misses
`travelPack` and `Asia/Bangkok`, while a substring match flags `replace` and `displacement`.
Identifiers are split on case changes and separators so the check sees what a reader sees.

**A third check was missing.** The lexicon can never see `import { db } from "@dt/db"` —
no forbidden word appears in it — and `package.json` cannot see it either, because a
source-only monorepo resolves workspace imports that were never declared. The engine could
have imported the entire product and both declared checks would have reported a clean tree.
`check-seam.ts` therefore also scans engine source for `@dt/*` import and dynamic-import
statements, after blanking comments so a comment saying *"never import from `@dt/db`"* does
not fail.

Two smaller rules that make the allowance ceiling mean something: an allow must carry a
reason, and an allow that suppresses nothing is an error. Without the second, allows
accumulate as dead comments and the count against the ceiling stops describing anything.

**Result on the real tree: zero allows.** The 28 hits it found were all fixable by rewriting,
not by exempting — engine test fixtures moved from `th-TH`/`Asia/Bangkok` to
`vi-VN`/`Asia/Ho_Chi_Minh` (chosen because `countries.ts` maps `vn` to the same substitute
egress, so every property under test survives), and engine comments now name markets by ISO
code. That the ceiling was never touched is the evidence the seam is in the right place.

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
